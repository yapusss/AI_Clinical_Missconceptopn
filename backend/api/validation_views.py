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

import json
import logging

from django.db import connection, transaction
from django.db.models import Count, Q
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import TokenAuthentication
from .models import (
    GeneratedReadingMaterial,
    LlmAnalysis,
    Question,
    QuestionSet,
    QuestionVersion,
    UserSubjectRole,
    Validation,
)
from .reading_materials import input_fingerprint, load_question_version_context
from .serializers import ValidationSubmitSerializer
from .views import is_lecturer_for_subject, plain_text_preview

logger = logging.getLogger(__name__)


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


def _reference_document_ids(references) -> list[str]:
    ids = set()
    for ref in references or []:
        if isinstance(ref, dict) and ref.get('document_id'):
            ids.add(str(ref['document_id']))
    return sorted(ids)


def _document_titles(document_ids) -> dict:
    """Resolve document ids → titles in one query (never per citation)."""
    if not document_ids:
        return {}
    with connection.cursor() as cur:
        cur.execute(
            'SELECT id::text, title FROM knowledge_documents WHERE id::text = ANY(%s)',
            [list(document_ids)],
        )
        return {str(row[0]): row[1] for row in cur.fetchall()}


def _attach_document_titles(references) -> list:
    """Add `document_title` to every reference entry (brief §10.2).

    One query for the whole list (none when it is empty). A malformed/missing or
    unknown `document_id` yields `document_title: None`; the key is present on
    every entry so the UI never has to join `/api/materials` or guess.
    """
    refs = list(references or [])
    titles = _document_titles(_reference_document_ids(refs))
    out = []
    for ref in refs:
        if isinstance(ref, dict):
            entry = dict(ref)
            doc_id = entry.get('document_id')
            entry['document_title'] = titles.get(str(doc_id)) if doc_id else None
        else:
            entry = {'document_title': None}
        out.append(entry)
    return out


def _reading_material_staleness(row, question_version_id):
    """`(stale, stale_reason)` recomputed at read time (C6, D18).

    A local sha256 over the current question text and reference answers compared
    against the value stored when the artifact was generated — **no network call
    and no embedding**. This is the only detector of an edited reference when no
    drain daemon is running, so it is not optional. `False` when the row has no
    stored fingerprint (a `PENDING`/`FAILED` row that never completed a
    generation) — there is nothing to call stale yet.
    """
    stored = getattr(row, 'input_fingerprint', None)
    if not stored:
        return False, None
    try:
        ctx = load_question_version_context(question_version_id)
    except Exception:  # noqa: BLE001 — a missing version must not 500 the detail
        return False, None
    recomputed = input_fingerprint(
        getattr(row, 'prompt_version', None),
        getattr(row, 'model_identifier', None),
        question_version_id,
        getattr(row, 'category', None),
        ctx.question_prompt,
        ctx.reference_short_answer,
        ctx.reference_reason,
    )
    if recomputed == stored:
        return False, None
    return (
        True,
        'Referensi jawaban dosen atau teks pertanyaan berubah sejak materi ini dibuat.',
    )


def _reading_material_detail(analysis):
    """The C6 reading-material block for one analysis, or `None`.

    Looked up by `(question_version_id, category)`. `None` is a legitimate answer:
    an `SC` analysis has no material by design (D6) and an analysis enqueued
    before the drain ran has a `PENDING`-era absence. `stale` is computed at read
    time (see `_reading_material_staleness`).
    """
    submission = getattr(analysis, 'submission', None)
    question_version_id = getattr(submission, 'question_version_id', None)
    category = getattr(analysis, 'four_tier_category', None)
    if question_version_id is None or category is None:
        return None
    row = GeneratedReadingMaterial.objects.filter(
        question_version_id=question_version_id, category=category
    ).first()
    if row is None:
        return None
    stale, stale_reason = _reading_material_staleness(row, question_version_id)
    return {
        # `id` is what the flag endpoint addresses; the rest is the review surface.
        'id': str(row.id),
        'status': row.status,
        'content_md': row.content_md,
        'sources': row.sources_json or [],
        'grounded': row.grounded,
        'ungrounded_source_count': row.ungrounded_source_count,
        'stale': stale,
        'stale_reason': stale_reason,
        'review_status': row.review_status,
        'flag_note': row.flag_note,
        'prompt_version': row.prompt_version,
        'model_identifier': row.model_identifier,
        'attempts': row.attempts,
    }


def _grounding_detail(analysis, breakdown: dict) -> dict:
    """Assemble the grounding/references block exposed to the lecturer UI.

    Stable shape across prompt versions: pre-R3 analyses (NULL grounding, no
    `references` key) still return every key with empty/None values, so the
    frontend never has to guess. `grounding.similarity_mean` measures alignment
    with the cited sources — it is NOT accuracy. C6 adds the generated
    `reading_material` block (or `None`) without removing any existing key.
    """
    return {
        'concept_breakdown_json': breakdown,
        'references': _attach_document_titles(breakdown.get('references') or []),
        'what_should_be_learned': breakdown.get('what_should_be_learned') or [],
        'suggested_materials': analysis.suggested_materials_json or [],
        # Flat keys kept for the authoritative brief §10.1 contract.
        'grounding_similarity': (
            float(analysis.grounding_similarity)
            if analysis.grounding_similarity is not None else None
        ),
        'grounding_payload': analysis.grounding_payload_json or {},
        # C5: answer-similarity + shadow verdict. Pre-C5 rows have NULLs; the
        # keys stay present (as `null`/`{}`) so the frontend never has to guess.
        'answer_similarity_t1': (
            float(analysis.answer_similarity_t1)
            if getattr(analysis, 'answer_similarity_t1', None) is not None else None
        ),
        'answer_similarity_t3': (
            float(analysis.answer_similarity_t3)
            if getattr(analysis, 'answer_similarity_t3', None) is not None else None
        ),
        'llm_t1_score': getattr(analysis, 'llm_t1_score', None),
        'llm_t3_score': getattr(analysis, 'llm_t3_score', None),
        'verdict_shadow': getattr(analysis, 'verdict_shadow_json', None) or {},
        # C6: the generated reading material for this (question_version, category),
        # or `None` when none exists (SC, or a pre-drain analysis).
        'reading_material': _reading_material_detail(analysis),
        # Nested block (R4 task §3).
        'grounding': {
            'similarity_mean': (
                float(analysis.grounding_similarity)
                if analysis.grounding_similarity is not None else None
            ),
            'similarity_max': (
                float(analysis.grounding_similarity_max)
                if analysis.grounding_similarity_max is not None else None
            ),
            'citation_count': analysis.grounding_citation_count,
            'payload': analysis.grounding_payload_json or {},
        },
    }


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


DIAGNOSTIC_CATEGORIES = [
    {
        'code': 'SC',
        'label': 'Sound Understanding',
        'description': 'Paham konsep secara utuh dan konsisten.'
    },
    {
        'code': 'LK',
        'label': 'Lack of Knowledge',
        'description': 'Kurang pengetahuan, ragu-ragu, atau indikasi menebak.'
    },
    {
        'code': 'FP',
        'label': 'False Positive',
        'description': 'Jawaban benar menutupi miskonsepsi pada alasan.'
    },
    {
        'code': 'MSC',
        'label': 'Misconception',
        'description': 'Miskonsepsi penuh dan diyakini secara konsisten.'
    },
    {
        'code': 'FN',
        'label': 'False Negative',
        'description': 'Penalaran ilmiah benar tetapi kesimpulan akhir keliru.'
    },
]

class ValidationTiersView(APIView):
    """Mengembalikan 5 Kategori Diagnostik Four-Tier untuk dropdown validasi dosen."""
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response([
            {
                'level': item['code'],  # Gunakan kode kategori sebagai value
                'label': f"[{item['code']}] {item['label']}",
                'description': item['description']
            }
            for item in DIAGNOSTIC_CATEGORIES
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
            category = getattr(a, 'four_tier_category', None)
            results.append({
                'analysis_id': str(a.id),
                'submission_id': str(a.submission_id),
                'run_number': a.run_number,
                'student_name': a.submission.student.full_name,
                'set_title': q_set.title if q_set else None,
                'set_code': q_set.code if q_set else None,
                'question_prompt_preview': plain_text_preview(v.prompt, 140) if v else '',
                'subject_name': a.subject.name,
                'percentage_correct': str(a.percentage_correct),
                'four_tier_category': category,
                'tier_level': a.tier_level_snapshot,
                'tier_label': f"[{category}]" if category else a.tier_label_snapshot,
                'confidence': str(a.confidence),
                'model_identifier': a.model_identifier,
                'submitted_at': a.submission.submitted_at,
                'answer_preview': a.submission.answer_text[:200],
            })

        return Response(results)


class ValidationDetailView(APIView):
    """Detail satu analisis untuk ditinjau: jawaban, keluaran LLM, miskonsepsi advisory."""

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
                'short_answer': v.short_answer or '',
                'model_answer': v.model_answer,
                'reference': {'short_answer': v.short_answer or '', 'reason': v.model_answer or ''},
            },
            'answer': {
                'text': sub.answer_text,
                'tier1_answer': getattr(sub, 'tier1_answer', None) or '',
                'tier2_confidence': getattr(sub, 'tier2_confidence', None) or 1,
                'tier3_reason': getattr(sub, 'tier3_reason', None) or sub.answer_text,
                'tier4_confidence': getattr(sub, 'tier4_confidence', None) or 1,
                'heuristic_flags': getattr(sub, 'heuristic_flags', None) or [],
                'attempt_no': sub.attempt_no,
                'submitted_at': sub.submitted_at,
            },
            'llm': {
                'model_identifier': a.model_identifier,
                'prompt_version': a.prompt_version,
                'percentage_correct': str(a.percentage_correct),
                'four_tier_category': getattr(a, 'four_tier_category', None),
                'risk_level': getattr(a, 'risk_level', None),
                'module_a_score': getattr(a, 'module_a_score', None),
                'module_b_score': getattr(a, 'module_b_score', None),
                'module_c_code': getattr(a, 'module_c_code', None),
                'tier_level': a.tier_level_snapshot,
                'tier_label': f"[{getattr(a, 'four_tier_category', None)}]" if getattr(a, 'four_tier_category', None) else a.tier_label_snapshot,
                'confidence': str(a.confidence),
                'explanation': a.explanation,
                'misconception_matches': matches,
                'proposed_new_misconception': breakdown.get('proposed_new_misconception'),
                'execution_time_ms': a.execution_time_ms,
                'created_at': a.created_at,
                **_grounding_detail(a, breakdown),
            },
            'validatable': sub.status == 'PENDING_VALIDATION',
            'existing_validation': existing_payload,
        })


class ValidationSubmitView(APIView):
    """Accept/edit/reject satu analisis via sp_validate_analysis (mendukung validasi baru & koreksi validasi)."""

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

        # Izinkan PENDING_VALIDATION (validasi baru) serta VALIDATED / REJECTED (koreksi oleh dosen)
        if a.submission.status not in ('PENDING_VALIDATION', 'VALIDATED', 'REJECTED'):
            return Response(
                {'detail': f'Submission dalam status {a.submission.status}; tidak dapat divalidasi.'},
                status=status.HTTP_409_CONFLICT,
            )

        serializer = ValidationSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        final_feedback = data.get('final_feedback') or None
        if data['status'] != 'REJECTED' and not final_feedback:
            final_feedback = a.explanation

        confirmations = data.get('misconception_confirmations') or []
        existing_val = Validation.objects.filter(analysis=a).first()

        try:
            with transaction.atomic():
                with connection.cursor() as cursor:
                    if existing_val:
                        # MODE KOREKSI: Update record validasi yang sudah ada
                        v_effective_final_pct = data.get('final_percentage') if data['status'] != 'REJECTED' else None
                        v_effective_final_tier = data.get('final_tier_level') if data['status'] != 'REJECTED' else None

                        v_final_tier_id = None
                        v_final_tier_level = None
                        v_final_tier_label = None

                        if data['status'] != 'REJECTED':
                            cursor.execute(
                                "SELECT tier_id, tier_level, tier_label FROM fn_resolve_diagnostic_tier(%s, %s);",
                                [str(a.subject_id), v_effective_final_tier or a.tier_level_snapshot]
                            )
                            tier_row = cursor.fetchone()
                            if tier_row:
                                v_final_tier_id, v_final_tier_level, v_final_tier_label = tier_row

                        structured_diff = {
                            'percentage': {
                                'from': float(existing_val.original_percentage),
                                'to': float(v_effective_final_pct) if v_effective_final_pct is not None else None,
                                'modified': float(existing_val.original_percentage) != float(v_effective_final_pct or 0),
                            },
                            'tier': {
                                'from_level': existing_val.original_tier_level_snapshot,
                                'to_level': v_final_tier_level,
                                'modified': str(existing_val.original_tier_id) != str(v_final_tier_id),
                            }
                        }

                        cursor.execute(
                            """
                            UPDATE validations
                            SET lecturer_id = %s,
                                status = %s,
                                final_percentage = %s,
                                final_tier_id = %s,
                                final_tier_level_snapshot = %s,
                                final_tier_label_snapshot = %s,
                                final_feedback = %s,
                                structured_diff_json = %s,
                                notes = %s,
                                validated_at = CURRENT_TIMESTAMP
                            WHERE id = %s;
                            """,
                            [
                                str(request.user.id),
                                data['status'],
                                v_effective_final_pct,
                                v_final_tier_id,
                                v_final_tier_level,
                                v_final_tier_label,
                                final_feedback if data['status'] != 'REJECTED' else None,
                                json.dumps(structured_diff),
                                data.get('notes') or None,
                                str(existing_val.id),
                            ]
                        )
                        validation_id = str(existing_val.id)

                        new_sub_status = 'REJECTED' if data['status'] == 'REJECTED' else 'VALIDATED'
                        cursor.execute(
                            "UPDATE submissions SET status = %s WHERE id = %s;",
                            [new_sub_status, str(a.submission_id)]
                        )

                        cursor.execute(
                            """
                            INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
                            VALUES (%s, 'UPDATE_VALIDATION', 'validations', %s, %s::jsonb);
                            """,
                            [
                                str(request.user.id),
                                str(existing_val.id),
                                json.dumps({'status': data['status'], 'diff': structured_diff})
                            ]
                        )
                    else:
                        # VALIDASI PERTAMA KALI
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
                'EDITED': 'Koreksi validasi tersimpan dan ditandai VALIDATED.',
                'REJECTED': 'Analisis ditolak; submission menunggu analisis ulang.',
            }[data['status']],
        }, status=status.HTTP_201_CREATED)

# ============================================================================
# MODEL PERFORMANCE METRICS (agreement with expert validations)
# ============================================================================

def _median(values):
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _analysis_question_version_ids(analyses):
    """Distinct question-version ids behind the scoped analyses (C5).

    Used to restrict `reading_material_counts` to the question versions in
    scope. Returns an empty set when the materialised rows carry no submission
    relation (the pure-helper tests build lightweight stand-ins), which keeps
    those tests DB-free.
    """
    ids = set()
    for a in analyses:
        submission = getattr(a, 'submission', None)
        question_version_id = getattr(submission, 'question_version_id', None)
        if question_version_id is not None:
            ids.add(question_version_id)
    return ids


def _reading_material_counts(question_version_ids):
    """Status histogram of `generated_reading_materials` (C5).

    Filtered to the analyses' question versions in scope. Every status key is
    always present (zero when absent) so the payload shape is stable, and
    `total` is their sum.
    """
    counts = {'READY': 0, 'PENDING': 0, 'STALE': 0, 'FAILED': 0}
    if question_version_ids:
        rows = (
            GeneratedReadingMaterial.objects
            .filter(question_version_id__in=question_version_ids)
            .values('status')
            .annotate(count=Count('id'))
        )
        for row in rows:
            if row['status'] in counts:
                counts[row['status']] = row['count']
    counts['total'] = sum(counts[k] for k in ('READY', 'PENDING', 'STALE', 'FAILED'))
    return counts


def _bucket_similarities(analyses, key):
    """Group non-NULL similarities by `key` for the per-bucket breakdowns.

    A row contributes when at least one tier similarity is non-NULL. Each
    bucket carries its own `count` plus the mean of whichever tier values are
    present, so a NULL tier drops out of that tier's mean without removing the
    row from the bucket count.
    """
    buckets = {}
    for a in analyses:
        s1 = getattr(a, 'answer_similarity_t1', None)
        s3 = getattr(a, 'answer_similarity_t3', None)
        if s1 is None and s3 is None:
            continue
        label = key(a) or 'UNKNOWN'
        entry = buckets.setdefault(label, {'count': 0, 't1': [], 't3': []})
        entry['count'] += 1
        if s1 is not None:
            entry['t1'].append(float(s1))
        if s3 is not None:
            entry['t3'].append(float(s3))
    return {
        label: {
            'count': v['count'],
            't1_mean': round(sum(v['t1']) / len(v['t1']), 4) if v['t1'] else None,
            't3_mean': round(sum(v['t3']) / len(v['t3']), 4) if v['t3'] else None,
        }
        for label, v in buckets.items()
    }


def _answer_similarity_metrics(analyses):
    """Answer-similarity + shadow-agreement aggregates (C5).

    Similarity measures alignment with the LECTURER's reference answer; it needs
    no lecturer validation and is NOT accuracy. The verdict is driven by the
    LLM, with the θ-based rule recorded in shadow, so `verdict_agreement_rate`
    is a diagnostic (how often the two disagree), not a quality score.
    """
    total = len(analyses)
    sim1 = [
        float(a.answer_similarity_t1) for a in analyses
        if getattr(a, 'answer_similarity_t1', None) is not None
    ]
    sim3 = [
        float(a.answer_similarity_t3) for a in analyses
        if getattr(a, 'answer_similarity_t3', None) is not None
    ]

    comparable = 0
    agree = 0
    for a in analyses:
        shadow = getattr(a, 'verdict_shadow_json', None) or {}
        rule_t1 = shadow.get('rule_t1')
        rule_t3 = shadow.get('rule_t3')
        llm_t1 = getattr(a, 'llm_t1_score', None)
        llm_t3 = getattr(a, 'llm_t3_score', None)
        if rule_t1 is None or rule_t3 is None or llm_t1 is None or llm_t3 is None:
            continue
        comparable += 1
        if llm_t1 == rule_t1 and llm_t3 == rule_t3:
            agree += 1

    similarity_count = len(sim1)
    return {
        'answer_similarity_t1_mean': round(sum(sim1) / len(sim1), 4) if sim1 else None,
        'answer_similarity_t1_median': round(_median(sim1), 4) if sim1 else None,
        'answer_similarity_t3_mean': round(sum(sim3) / len(sim3), 4) if sim3 else None,
        'answer_similarity_t3_median': round(_median(sim3), 4) if sim3 else None,
        'answer_similarity_coverage': (
            round(similarity_count / total, 4) if total else None
        ),
        'no_similarity_count': total - similarity_count,
        'answer_similarity_by_category': _bucket_similarities(
            analyses, lambda a: getattr(a, 'four_tier_category', None)
        ),
        'answer_similarity_by_prompt_version': _bucket_similarities(
            analyses, lambda a: getattr(a, 'prompt_version', None)
        ),
        'verdict_agreement_rate': round(agree / comparable, 4) if comparable else None,
        'verdict_disagreement_count': comparable - agree,
        'verdict_comparable_count': comparable,
    }


def _grounding_metrics(analyses):
    """Grounding (citation-fidelity) metrics — properties of the ANALYSIS.

    These are derived from the LLM's own output (`grounding_similarity` +
    `grounding_payload_json.references`) and therefore require **no lecturer
    validation** and no ground truth. Grounding similarity measures alignment
    between the AI's advice and the passages it cited; it is NOT accuracy.

    C5 extends this block (additive only — every historical key is retained)
    with answer-similarity aggregates, the shadow-vs-LLM verdict agreement and
    the reading-material status counts. All are computed over **all current
    analyses in scope**, model-filter-aware, exactly like grounding.
    """
    total = len(analyses)
    grounded = [a for a in analyses if (a.grounding_citation_count or 0) >= 1]
    sims = [
        float(a.grounding_similarity)
        for a in grounded
        if a.grounding_similarity is not None
    ]

    valid_citations = 0
    all_citations = 0
    by_category = {}
    by_prompt = {}
    # Citation validity is counted over ALL analyses in scope (denominator =
    # every citation in grounding_payload_json.references), independent of the
    # similarity grouping below.
    for a in analyses:
        payload = a.grounding_payload_json or {}
        for ref in (payload.get('references') or []):
            all_citations += 1
            if ref.get('valid'):
                valid_citations += 1
    for a in grounded:
        sim = float(a.grounding_similarity) if a.grounding_similarity is not None else None
        if sim is not None:
            cat = getattr(a, 'four_tier_category', None) or 'UNKNOWN'
            pv = getattr(a, 'prompt_version', None) or 'UNKNOWN'
            by_category.setdefault(cat, {'count': 0, 'sum': 0.0})
            by_category[cat]['count'] += 1
            by_category[cat]['sum'] += sim
            by_prompt.setdefault(pv, {'count': 0, 'sum': 0.0})
            by_prompt[pv]['count'] += 1
            by_prompt[pv]['sum'] += sim

    validity_rate = round(valid_citations / all_citations, 4) if all_citations else None

    question_version_ids = _analysis_question_version_ids(analyses)

    return {
        'grounding_similarity_mean': round(sum(sims) / len(sims), 4) if sims else None,
        'grounding_similarity_median': round(_median(sims), 4) if sims else None,
        'citation_coverage': round(len(grounded) / total, 4) if total else None,
        'citation_validity_rate': validity_rate,
        'hallucinated_citation_rate': round(1 - validity_rate, 4) if validity_rate is not None else None,
        'grounding_by_category': {
            k: {'count': v['count'], 'similarity_mean': round(v['sum'] / v['count'], 4)}
            for k, v in by_category.items()
        },
        'grounding_by_prompt_version': {
            k: {'count': v['count'], 'similarity_mean': round(v['sum'] / v['count'], 4)}
            for k, v in by_prompt.items()
        },
        'no_grounding_count': total - len(grounded),
        # --- C5 additive block (never a replacement for the keys above) ---
        **_answer_similarity_metrics(analyses),
        'reading_material_counts': _reading_material_counts(question_version_ids),
    }


def _compute_metrics(scored, all_validations):
    """Agreement metrics over scored (ACCEPTED/EDITED) validations.

    Returns the validation-derived payload only; `all_validations` feeds the
    rejection-rate denominator. Grounding keys are NOT merged here — they are
    computed from all current analyses in scope (see `_grounding_metrics` /
    `_scope_analyses`) so they never depend on a validation existing.
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

    payload = {
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
    return payload


METRICS_NOTE = (
    'Metrik kesesuaian = perbandingan dengan validasi dosen (satu-satunya ground truth di sistem). '
    'Metrik grounding = keselarasan keluaran AI dengan kutipan sumber yang dipilihnya sendiri; '
    'tidak memerlukan validasi dosen dan BUKAN akurasi. '
    'Answer similarity = cosine(jawaban siswa, jawaban referensi dosen), diukur terhadap jawaban '
    'referensi dosen, tidak memerlukan validasi dosen, dan BUKAN akurasi. '
    'Verdict digerakkan oleh LLM; aturan berbasis θ (theta) dicatat sebagai shadow dan tidak '
    'menggerakkan kategori mana pun. verdict_agreement_rate mengukur seberapa sering kedua verdict '
    'berbeda — ini diagnostik, bukan skor kualitas, dan kalibrasi dilakukan terhadap dosen, '
    'bukan terhadap LLM.'
)


def _scope_analyses(user, subject_id=None, model_filter=None):
    """All CURRENT analyses in the caller's subject scope (grounding source).

    Grounding is a property of the analysis and needs no lecturer validation, so
    it is computed over every current analysis in scope — not only the ones that
    happen to have a validation. A grounding number that only appears (or
    changes) after a validation would be useless as a pre-validation signal.

    Scope = lecturer subject scope (superuser: all) + optional `?subject_id=` +
    optional `?model=`. The model filter must narrow the grounding block too, or
    `?model=` would leak pooled numbers from other providers.
    """
    qs = LlmAnalysis.objects.filter(_scope_filter(user), is_current=True).select_related('submission')
    if subject_id:
        qs = qs.filter(subject_id=subject_id)
    if model_filter:
        qs = qs.filter(model_identifier=model_filter)
    return qs


def _filter_analyses_by_model(analyses, model_filter):
    """Pure post-condition for the `?model=` scope (DB-free testable).

    `_scope_analyses` narrows the query in the ORM; this enforces the same
    invariant on the materialised list so no unfiltered row can slip into the
    grounding block.
    """
    if not model_filter:
        return list(analyses)
    return [a for a in analyses if a.model_identifier == model_filter]


def _by_model_row(identifier, validation_rows, analysis_rows):
    """One compact per-model comparison row.

    Validation-derived fields come from `validation_rows`; the grounding keys
    come from `analysis_rows` (that model's current analyses in scope), so a
    model with analyses but no validations still reports grounding.

    C5F (D16 — calibrate per model): the answer-similarity keys and the
    shadow-vs-LLM agreement keys are computed from the SAME `analysis_rows`
    list the grounding keys use. They are not read from a fresh query — the
    R5F bug was a second query that bypassed the model filter. "A θ fitted on
    one model does not transfer to another", so every number the per-model
    calibration reads has to live on the row.
    """
    scored = [v for v in validation_rows if v.status in ('ACCEPTED', 'EDITED')]
    m = _compute_metrics(scored, validation_rows)
    g = _grounding_metrics(analysis_rows)
    s = _answer_similarity_metrics(analysis_rows)
    return {
        'model_identifier': identifier,
        'total_validations': m['total_validations'],
        'scored_validations': m['scored_validations'],
        'rejection_rate': m['rejection_rate'],
        'tier_agreement_accuracy': m['tier_agreement_accuracy'],
        'macro_f1': m['macro_f1'],
        'percentage_mae': m['percentage_mae'],
        'expected_calibration_error': m['expected_calibration_error'],
        'grounding_similarity_mean': g['grounding_similarity_mean'],
        'citation_coverage': g['citation_coverage'],
        'citation_validity_rate': g['citation_validity_rate'],
        'hallucinated_citation_rate': g['hallucinated_citation_rate'],
        # --- C5F: per-model similarity + shadow agreement (D16) ---
        # Same definitions as the top-level C5 block, but evaluated over this
        # model's own analyses so the per-model calibration is readable.
        'answer_similarity_t1_mean': s['answer_similarity_t1_mean'],
        'answer_similarity_t3_mean': s['answer_similarity_t3_mean'],
        'answer_similarity_coverage': s['answer_similarity_coverage'],
        'verdict_agreement_rate': s['verdict_agreement_rate'],
        'verdict_comparable_count': s['verdict_comparable_count'],
    }


def _zero_validation_payload(analyses, model_filter=None):
    """Payload when no validations exist yet: grounding is still reported.

    Validation-derived metrics stay absent (no invented zeros); the 8 grounding
    keys and one `by_model` row per model present in scope are always returned.
    """
    identifiers = sorted({a.model_identifier for a in analyses})
    by_model = [
        _by_model_row(identifier, [], [a for a in analyses if a.model_identifier == identifier])
        for identifier in identifiers
    ]
    payload = {
        'total_validations': 0,
        'message': 'Belum ada data validasi — metrik grounding tetap dihitung dari analisis; '
                   'metrik kesesuaian tersedia setelah dosen memvalidasi analisis.',
        **_grounding_metrics(analyses),
        'by_model': by_model,
        'note': METRICS_NOTE,
    }
    if model_filter:
        payload['model_filter'] = model_filter
    return payload


class ModelMetricsView(APIView):
    """Metrik kinerja model LLM vs validasi dosen (LECTURER scope).

    Computed over validations of ACCEPTED/EDITED status:
    - tier agreement (accuracy), macro-F1 over tiers, confusion matrix
    - MAE/RMSE on percentage
    - calibration: agreement rate per confidence bin (+ ECE)
    - rejection rate over ALL validations
    - grounding (citation fidelity): mean/median similarity, citation coverage,
      citation validity / hallucinated rate, per-category and per-prompt-version
      breakdowns. Grounding is a property of the ANALYSIS and needs no lecturer
      validation; it is source-alignment, NOT accuracy. It is computed over all
      current analyses in scope — not only the ones that have a validation — so
      the number is available as a pre-validation signal and never changes just
      because a validation appears.

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

        # Grounding source: all current analyses in scope (no validation needed),
        # narrowed by ?subject_id= and ?model= so the filter restricts the block.
        analyses = _filter_analyses_by_model(
            list(_scope_analyses(request.user, subject_id, model_filter)), model_filter
        )

        total = len(all_validations)
        if total == 0:
            return Response(_zero_validation_payload(analyses, model_filter))

        payload = _compute_metrics(
            [v for v in all_validations if v.status in ('ACCEPTED', 'EDITED')],
            all_validations,
        )
        payload.update(_grounding_metrics(analyses))

        # by_model: the validation-derived model set is unchanged; the grounding
        # keys of each row come from that model's analyses in scope.
        by_model = []
        for identifier in sorted({v.analysis.model_identifier for v in all_validations}):
            rows = [v for v in all_validations if v.analysis.model_identifier == identifier]
            model_analyses = [a for a in analyses if a.model_identifier == identifier]
            by_model.append(_by_model_row(identifier, rows, model_analyses))

        payload['by_model'] = by_model
        if model_filter:
            payload['model_filter'] = model_filter
        payload['note'] = METRICS_NOTE
        return Response(payload)
