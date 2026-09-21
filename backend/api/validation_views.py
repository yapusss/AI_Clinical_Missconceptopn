# ============================================================================
# SPRINT 5: LECTURER VALIDATION API (P5) + MODEL PERFORMANCE METRICS
# ============================================================================
#
# P5 flow (spec: Context/System_Context.md §P5):
#   queue  = current analyses of submissions in PENDING_VALIDATION (lecturer subjects)
#   detail = side-by-side review: student answer + model answer + LLM breakdown
#            + advisory misconception matches (lecturer confirms/denies each)
#   action = sp_validate_analysis(ACCEPTED|EDITED|REJECTED)
#            - ACCEPTED: exact agreement -> few_shot_examples (proc does this)
#            - EDITED:   corrections -> correction_examples (proc does this)
#            - REJECTED: submission eligible for re-analysis (worker picks up)
#
# Metrics are computed over `validations` (original_* vs final_* columns):
# agreement-with-expert metrics; there is no other ground truth in this system.

from django.db import connection, transaction
from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import TokenAuthentication
from .models import (
    ConceptIndicator,
    LlmAnalysis,
    Question,
    QuestionSet,
    QuestionVersion,
    UserSubjectRole,
    Validation,
)
from .serializers import ValidationSubmitSerializer
from .views import is_lecturer_for_subject


def _lecturer_subject_ids(user):
    return list(
        UserSubjectRole.objects.filter(
            user=user, role=UserSubjectRole.Role.LECTURER
        ).values_list('subject_id', flat=True)
    )


def _scope_filter(user):
    """Q limiting rows to subjects this lecturer owns (superuser: all)."""
    if user.is_superuser:
        return Q()
    ids = _lecturer_subject_ids(user)
    return Q(subject_id__in=ids) if ids else Q(pk__in=[])


def _misconception_confirmations(breakdown: dict, confirmations: list) -> dict:
    """Merge lecturer confirmations into the analysis breakdown (in place).

    Advisory matches live on concept_breakdown_json.misconception_matches;
    each reviewed match gets `lecturer_confirmed: true/false`. The enriched
    breakdown is persisted back onto llm_analyses (data enrichment, not a
    lifecycle write — the status transition goes through sp_validate_analysis).
    """
    by_id = {str(c['misconception_id']): bool(c['confirmed']) for c in confirmations}
    matches = breakdown.get('misconception_matches') or []
    for m in matches:
        mid = str(m.get('misconception_id'))
        if mid in by_id:
            m['lecturer_confirmed'] = by_id[mid]
    return by_id


class ValidationTiersView(APIView):
    """Tier diagnosis yang tersedia untuk subject (subject-specific menang atas universal).

    Mirrors fn_resolve_diagnostic_tier's precedence so the P5 tier picker never
    offers levels the proc would reject.
    """

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        subject_id = request.query_params.get('subject_id')
        if not subject_id:
            return Response({'detail': 'subject_id wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)
        if not is_lecturer_for_subject(request.user, subject_id):
            return Response({'detail': 'Anda tidak berwenang untuk mata kuliah ini.'},
                            status=status.HTTP_403_FORBIDDEN)

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (dt.level) dt.level, dt.label, coalesce(dt.description, '')
                FROM diagnostic_tiers dt
                WHERE dt.is_active AND (dt.subject_id = %s OR dt.subject_id IS NULL)
                ORDER BY dt.level, dt.subject_id NULLS LAST
                """,
                [subject_id],
            )
            rows = cur.fetchall()

        return Response([
            {'level': r[0], 'label': r[1], 'description': r[2]} for r in rows
        ])


class ValidationQueueView(APIView):
    """Antrian validasi dosen: analisis berjalan (is_current) pada submission PENDING_VALIDATION."""

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        scope = _scope_filter(request.user)
        analyses = (
            LlmAnalysis.objects.filter(scope, is_current=True, submission__status='PENDING_VALIDATION')
            .select_related('submission__student', 'subject')
            .order_by('submission__submitted_at')
        )

        version_ids = {a.submission.question_version_id for a in analyses}
        versions = {v.id: v for v in QuestionVersion.objects.filter(id__in=version_ids)}
        question_ids = {v.question_id for v in versions.values()}
        questions = {q.id: q for q in Question.objects.filter(id__in=question_ids)}
        set_ids = {q.question_set_id for q in questions.values()}
        sets_map = {s.id: s for s in QuestionSet.objects.filter(id__in=set_ids)}

        results = []
        for a in analyses:
            v = versions.get(a.submission.question_version_id)
            q = questions.get(v.question_id) if v else None
            q_set = sets_map.get(q.question_set_id) if q else None
            results.append({
                'analysis_id': str(a.id),
                'submission_id': str(a.submission_id),
                'run_number': a.run_number,
                'student_name': a.submission.student.full_name,
                'set_title': q_set.title if q_set else None,
                'set_code': q_set.code if q_set else None,
                'question_prompt_preview': (v.prompt[:140] + ('...' if len(v.prompt) > 140 else '')) if v else '',
                'subject_name': a.subject.name,
                'percentage_correct': str(a.percentage_correct),
                'tier_level': a.tier_level_snapshot,
                'tier_label': a.tier_label_snapshot,
                'confidence': str(a.confidence),
                'model_identifier': a.model_identifier,
                'submitted_at': a.submission.submitted_at,
                'answer_preview': a.submission.answer_text[:200],
            })

        return Response(results)


class ValidationDetailView(APIView):
    """Detail satu analisis untuk ditinjau: jawaban, rubrik, keluaran LLM, miskonsepsi advisory."""

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, analysis_id):
        scope = _scope_filter(request.user)
        try:
            a = LlmAnalysis.objects.filter(scope).select_related(
                'submission__student', 'subject'
            ).get(pk=analysis_id, is_current=True)
        except LlmAnalysis.DoesNotExist:
            return Response({'detail': 'Analisis tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        sub = a.submission
        v = QuestionVersion.objects.get(pk=sub.question_version_id)
        q = Question.objects.get(pk=v.question_id)
        q_set = QuestionSet.objects.get(pk=q.question_set_id)
        indicators = list(
            ConceptIndicator.objects.filter(question_version=v).order_by('order_index')
        )

        breakdown = a.concept_breakdown_json or {}
        matches = breakdown.get('misconception_matches') or []

        existing = Validation.objects.filter(analysis=a).select_related('lecturer').first()
        existing_payload = None
        if existing:
            existing_payload = {
                'status': existing.status,
                'final_percentage': str(existing.final_percentage) if existing.final_percentage is not None else None,
                'final_tier_level': existing.final_tier_level_snapshot,
                'final_feedback': existing.final_feedback,
                'lecturer_name': existing.lecturer.full_name,
                'validated_at': existing.validated_at,
            }

        return Response({
            'analysis_id': str(a.id),
            'submission_id': str(sub.id),
            'run_number': a.run_number,
            'submission_status': sub.status,
            'student': {'id': str(sub.student_id), 'name': sub.student.full_name},
            'subject': {'id': str(a.subject_id), 'name': a.subject.name},
            'set': {'id': str(q_set.id), 'code': q_set.code, 'title': q_set.title},
            'question': {
                'version_id': str(v.id),
                'version_number': v.version_number,
                'prompt': v.prompt,
                'model_answer': v.model_answer,
                'indicators': [
                    {
                        'order_index': i.order_index,
                        'label': i.label,
                        'description': i.description or '',
                        'weight': str(i.weight),
                    }
                    for i in indicators
                ],
            },
            'answer': {
                'text': sub.answer_text,
                'attempt_no': sub.attempt_no,
                'submitted_at': sub.submitted_at,
            },
            'llm': {
                'model_identifier': a.model_identifier,
                'prompt_version': a.prompt_version,
                'percentage_correct': str(a.percentage_correct),
                'tier_level': a.tier_level_snapshot,
                'tier_label': a.tier_label_snapshot,
                'confidence': str(a.confidence),
                'explanation': a.explanation,
                'indicator_scores': breakdown.get('indicators') or [],
                'misconception_matches': matches,
                'proposed_new_misconception': breakdown.get('proposed_new_misconception'),
                'execution_time_ms': a.execution_time_ms,
                'created_at': a.created_at,
            },
            'validatable': sub.status == 'PENDING_VALIDATION',
            'existing_validation': existing_payload,
        })


class ValidationSubmitView(APIView):
    """Accept/edit/reject satu analisis via sp_validate_analysis (lifecycle write through proc)."""

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request, analysis_id):
        scope = _scope_filter(request.user)
        try:
            a = LlmAnalysis.objects.filter(scope).select_related('submission').get(
                pk=analysis_id, is_current=True
            )
        except LlmAnalysis.DoesNotExist:
            return Response({'detail': 'Analisis tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        if a.submission.status != 'PENDING_VALIDATION':
            return Response(
                {'detail': f'Submission dalam status {a.submission.status}; hanya PENDING_VALIDATION yang dapat divalidasi.'},
                status=status.HTTP_409_CONFLICT,
            )

        serializer = ValidationSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        final_feedback = data.get('final_feedback') or None
        # chk_final_required_unless_rejected: ACCEPTED/EDITED need final values;
        # proc COALESCEs to originals when NULL, but final_feedback must be present.
        if data['status'] != 'REJECTED' and not final_feedback:
            final_feedback = a.explanation  # accept LLM explanation as feedback when unchanged

        confirmations = data.get('misconception_confirmations') or []

        try:
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(
                        'CALL sp_validate_analysis(%s, %s, %s, %s, %s, %s, %s, NULL);',
                        [
                            str(a.id),
                            str(request.user.id),
                            data['status'],
                            data.get('final_percentage'),
                            data.get('final_tier_level'),
                            final_feedback,
                            data.get('notes') or None,
                        ],
                    )
                    row = cursor.fetchone()
                    validation_id = str(row[0]) if row and row[0] else None

                # Persist lecturer confirmations of advisory misconception matches
                # onto the analysis breakdown (data enrichment; the status
                # transition above already went through the proc).
                if confirmations:
                    breakdown = a.concept_breakdown_json or {}
                    _misconception_confirmations(breakdown, confirmations)
                    LlmAnalysis.objects.filter(pk=a.pk).update(concept_breakdown_json=breakdown)
        except Exception as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        a.submission.refresh_from_db()
        return Response({
            'validation_id': validation_id,
            'analysis_id': str(a.id),
            'submission_status': a.submission.status,
            'message': {
                'ACCEPTED': 'Analisis diterima dan ditandai VALIDATED.',
                'EDITED': 'Koreksi tersimpan dan ditandai VALIDATED.',
                'REJECTED': 'Analisis ditolak; submission menunggu analisis ulang.',
            }[data['status']],
        }, status=status.HTTP_201_CREATED)


# ============================================================================
# MODEL PERFORMANCE METRICS (agreement with expert validations)
# ============================================================================

def _compute_metrics(scored, all_validations):
    """Agreement metrics over scored (ACCEPTED/EDITED) validations.

    Returns the full payload dict; `all_validations` only feeds the
    rejection-rate denominator.
    """
    total = len(all_validations)
    rejected = sum(1 for v in all_validations if v.status == 'REJECTED')

    # --- tier agreement / accuracy / macro-F1 / confusion ---
    pairs = [
        (v.original_tier_level_snapshot, v.final_tier_level_snapshot)
        for v in scored
        if v.final_tier_level_snapshot is not None
    ]
    tiers = sorted({p for pair in pairs for p in pair})
    confusion = {str(t): {str(u): 0 for u in tiers} for t in tiers}
    for orig, final in pairs:
        confusion[str(orig)][str(final)] += 1

    agree = sum(1 for o, f in pairs if o == f)
    n = len(pairs)
    accuracy = round(agree / n, 4) if n else None

    f1s = []
    per_tier = []
    for t in tiers:
        tp = sum(1 for o, f in pairs if o == t and f == t)
        fp = sum(1 for o, f in pairs if o != t and f == t)
        fn = sum(1 for o, f in pairs if o == t and f != t)
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        f1s.append(f1)
        per_tier.append({
            'tier_level': t,
            'support': sum(1 for _, f in pairs if f == t),
            'precision': round(precision, 4),
            'recall': round(recall, 4),
            'f1': round(f1, 4),
        })
    macro_f1 = round(sum(f1s) / len(f1s), 4) if f1s else None

    # --- percentage error ---
    errs = [
        abs(float(v.original_percentage) - float(v.final_percentage))
        for v in scored
        if v.final_percentage is not None
    ]
    mae = round(sum(errs) / len(errs), 2) if errs else None
    rmse = round((sum(e * e for e in errs) / len(errs)) ** 0.5, 2) if errs else None

    # --- calibration (confidence bins of 0.1) + ECE ---
    bins = {}
    ece = 0.0
    for v in scored:
        if v.final_tier_level_snapshot is None:
            continue
        conf = float(v.analysis.confidence)
        b = min(9, int(conf * 10))
        ok = 1.0 if v.original_tier_level_snapshot == v.final_tier_level_snapshot else 0.0
        entry = bins.setdefault(b, {'count': 0, 'agree': 0.0, 'conf_sum': 0.0})
        entry['count'] += 1
        entry['agree'] += ok
        entry['conf_sum'] += conf
    scored_n = sum(e['count'] for e in bins.values())
    calibration = []
    for b in sorted(bins):
        e = bins[b]
        rate = e['agree'] / e['count']
        avg_conf = e['conf_sum'] / e['count']
        if scored_n:
            ece += (e['count'] / scored_n) * abs(rate - avg_conf)
        calibration.append({
            'bin': f'{b / 10:.1f}-{(b + 1) / 10:.1f}',
            'count': e['count'],
            'agreement_rate': round(rate, 4),
            'avg_confidence': round(avg_conf, 4),
        })

    return {
        'total_validations': total,
        'rejection_rate': round(rejected / total, 4) if total else None,
        'scored_validations': len(scored),
        'tier_agreement_accuracy': accuracy,
        'macro_f1': macro_f1,
        'per_tier': per_tier,
        'confusion_matrix': confusion,
        'percentage_mae': mae,
        'percentage_rmse': rmse,
        'calibration': calibration,
        'expected_calibration_error': round(ece, 4) if scored_n else None,
    }


class ModelMetricsView(APIView):
    """Metrik kinerja model LLM vs validasi dosen (LECTURER scope).

    Computed over validations of ACCEPTED/EDITED status:
    - tier agreement (accuracy), macro-F1 over tiers, confusion matrix
    - MAE/RMSE on percentage
    - calibration: agreement rate per confidence bin (+ ECE)
    - rejection rate over ALL validations

    Query params:
    - ?subject_id=   restrict to one subject
    - ?model=        restrict the whole payload to one model_identifier
    Response always includes `by_model`: compact per-model comparison rows
    (providers grade differently, so pooled numbers can mislead).
    """

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        scope = _scope_filter(request.user)
        subject_id = request.query_params.get('subject_id')
        model_filter = request.query_params.get('model')

        qs = Validation.objects.filter(scope)
        if subject_id:
            qs = qs.filter(subject_id=subject_id)
        if model_filter:
            qs = qs.filter(analysis__model_identifier=model_filter)
        qs = qs.select_related('analysis')

        all_validations = list(qs)
        total = len(all_validations)
        if total == 0:
            return Response({
                'total_validations': 0,
                'by_model': [],
                'message': 'Belum ada data validasi — metrik tersedia setelah dosen memvalidasi analisis.',
            })

        payload = _compute_metrics(
            [v for v in all_validations if v.status in ('ACCEPTED', 'EDITED')],
            all_validations,
        )

        # Compact per-model comparison rows (computed from unfiltered-by-model set)
        by_model = []
        for identifier in sorted({v.analysis.model_identifier for v in all_validations}):
            rows = [v for v in all_validations if v.analysis.model_identifier == identifier]
            m = _compute_metrics(
                [v for v in rows if v.status in ('ACCEPTED', 'EDITED')], rows
            )
            by_model.append({
                'model_identifier': identifier,
                'total_validations': m['total_validations'],
                'scored_validations': m['scored_validations'],
                'rejection_rate': m['rejection_rate'],
                'tier_agreement_accuracy': m['tier_agreement_accuracy'],
                'macro_f1': m['macro_f1'],
                'percentage_mae': m['percentage_mae'],
                'expected_calibration_error': m['expected_calibration_error'],
            })

        payload['by_model'] = by_model
        if model_filter:
            payload['model_filter'] = model_filter
        payload['note'] = 'Metrik = kesesuaian dengan validasi dosen (satu-satunya ground truth di sistem).'
        return Response(payload)
