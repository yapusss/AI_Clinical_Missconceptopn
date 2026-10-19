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
import uuid

from django.db import IntegrityError, ProgrammingError, connection, transaction
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
from .reading_materials import (
    enqueue_reading_material,
    input_fingerprint,
    lecturer_category,
    load_question_version_context,
)
from .serializers import ValidationSubmitSerializer
from .views import is_lecturer_for_subject, plain_text_preview
from .worker_health import worker_status

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


# Statuses whose analysis the lecturer may re-run from the review page.
# ANALYSIS_FAILED is the dead-end this action exists for; PENDING_VALIDATION/VALIDATED
# are "Tolak & analisis ulang" — the lecturer is criticising an analysis that exists and
# wants another one, which must not be written as a *validation* (that is what made a
# rejected item look validated and then refused once the re-analysis failed).
# SUBMITTED/ANALYZING are excluded: already queued or running.
REANALYZABLE_STATUSES = ('ANALYSIS_FAILED', 'PENDING_VALIDATION', 'VALIDATED', 'REJECTED')

# The supervisor ticks every 10s and each worker heartbeats on every tick, so an older
# heartbeat means nothing will consume the queue and a retry would look like a no-op.
ANALYSIS_WORKER_STALE_SECONDS = 30


def _analysis_worker_state():
    """`'alive' | 'stale' | 'missing'` for the analysis drain."""
    rows = worker_status('analysis')
    if not rows:
        return 'missing'
    try:
        age = float(rows[0].get('age_seconds'))
    except (TypeError, ValueError):
        return 'stale'
    return 'alive' if age <= ANALYSIS_WORKER_STALE_SECONDS else 'stale'


class SubmissionReanalyzeView(APIView):
    """Re-run the AI analysis for one submission (lecturer-scoped).

    Serves both halves of the review page:
    - **Proses ulang analisis** on a submission whose inference died (`ANALYSIS_FAILED`
      is terminal for the worker: `_claim_next()` requires `analysis_attempts <
      LLM_MAX_RUNS`), which is why the old "dijadwalkan ulang oleh sistem" was untrue.
    - **Tolak & analisis ulang** on an analysis the lecturer rejects. That used to be
      written through `sp_validate_analysis(REJECTED)`, i.e. as a *validation* record: the
      item then looked validated, and once the re-analysis failed the submission sat at
      `ANALYSIS_FAILED` where the validation endpoint refuses it
      ("Submission dalam status ANALYSIS_FAILED; tidak dapat divalidasi"). Re-analysis is
      a request to run the model again, not a review decision.

    Nothing is analysed inside the request; the row goes back to `SUBMITTED` with a fresh
    attempt counter, so the response is `202` and reports whether the worker is running.
    An optional `notes` becomes `llm_analyses.lecturer_note` on the analysis being
    criticised, which the prompts surface as "[CATATAN DOSEN PADA ANALISIS SEBELUMNYA]".

    A failed run also leaves its reading material `FAILED`, and that drain only selects
    `PENDING`/`STALE` — so the same action re-queues those rows too. Without that a
    lecturer fixes the analysis and still sees "no Materi Bacaan".
    """

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        with connection.cursor() as cur:
            cur.execute(
                'SELECT subject_id, question_version_id, status, analysis_attempts '
                'FROM submissions WHERE id = %s',
                [str(pk)],
            )
            row = cur.fetchone()
        if row is None:
            return Response(
                {'detail': 'Submission tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND
            )

        subject_id, question_version_id, current, attempts = row
        if not is_lecturer_for_subject(request.user, str(subject_id)):
            return Response(
                {'detail': 'Anda tidak mengajar mata kuliah ini.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if current not in REANALYZABLE_STATUSES:
            return Response(
                {
                    'detail': f'Submission berstatus {current}; hanya analisis yang gagal '
                              'dapat dijalankan ulang.'
                },
                status=status.HTTP_409_CONFLICT,
            )

        with transaction.atomic():
            with connection.cursor() as cur:
                # The lecturer's reason lands on the analysis being criticised, which is
                # what `load_context` reads for "[CATATAN DOSEN PADA ANALISIS SEBELUMNYA]".
                # It must not become a `validations` row: that record is what marks an
                # item reviewed, and writing it here made a rejected item look validated.
                note = (request.data.get('notes') or '').strip() if hasattr(request, 'data') else ''
                note_saved = False
                if note:
                    cur.execute(
                        """UPDATE llm_analyses
                           SET lecturer_note = %s
                           WHERE submission_id = %s AND is_current = TRUE""",
                        [note[:2000], str(pk)],
                    )
                    note_saved = cur.rowcount > 0
                cur.execute(
                    """UPDATE submissions
                       SET status = 'SUBMITTED', analysis_attempts = 0
                       WHERE id = %s""",
                    [str(pk)],
                )
                cur.execute(
                    """UPDATE generated_reading_materials
                       SET status = 'PENDING', error = NULL, attempts = 0
                       WHERE question_version_id = %s AND status = 'FAILED'""",
                    [str(question_version_id)],
                )
                materials_requeued = cur.rowcount

        logger.info(
            'Submission %s re-queued for analysis by user %s (was %s after %s attempt(s), note=%s)',
            pk, request.user.id, current, attempts, 'yes' if note_saved else 'no',
        )

        return Response(
            {
                'id': str(pk),
                'status': 'SUBMITTED',
                'analysis_attempts': 0,
                'previous_status': current,
                'previous_attempts': attempts,
                'note_saved': note_saved,
                'reading_materials_requeued': materials_requeued,
                'analysis_worker': _analysis_worker_state(),
            },
            status=status.HTTP_202_ACCEPTED,
        )


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


def _concept_names(concept_ids):
    """`{str(concept_id): name}` for the given concepts; `{}` on any failure.

    Catalogue metadata is a presentational extra: a lookup failure must degrade
    to a name-less candidate, never break the review page.
    """
    ids = [str(c) for c in concept_ids if c]
    if not ids:
        return {}
    try:
        with connection.cursor() as cur:
            cur.execute(
                'SELECT id, name FROM concepts WHERE id = ANY(%s::uuid[])',
                [ids],
            )
            return {str(row[0]): row[1] for row in cur.fetchall()}
    except Exception:  # noqa: BLE001 — never fail the surface on a lookup
        logger.warning('Could not resolve catalogue concept names', exc_info=True)
        return {}


def _concept_misconceptions(concept_ids):
    """`{str(concept_id): [{'id','label'}]}` — the override options per concept."""
    ids = [str(c) for c in concept_ids if c]
    if not ids:
        return {}
    try:
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT concept_id, id, label
                FROM misconceptions
                WHERE concept_id = ANY(%s::uuid[])
                ORDER BY concept_id, label
                """,
                [ids],
            )
            options = {}
            for concept_id, misconception_id, label in cur.fetchall():
                options.setdefault(str(concept_id), []).append(
                    {'id': str(misconception_id), 'label': label})
            return options
    except Exception:  # noqa: BLE001 — never fail the surface on a lookup
        logger.warning('Could not resolve catalogue misconceptions', exc_info=True)
        return {}


def _misconception_label(misconception_id):
    """The catalogue misconception's label, or `None` when it cannot be read."""
    if not misconception_id:
        return None
    try:
        with connection.cursor() as cur:
            cur.execute(
                'SELECT label FROM misconceptions WHERE id = %s',
                [str(misconception_id)],
            )
            row = cur.fetchone()
            return row[0] if row else None
    except Exception:  # noqa: BLE001 — never fail the surface on a lookup
        logger.warning('Could not resolve misconception label', exc_info=True)
        return None


def missing_concepts_surface(breakdown, limit=3) -> list:
    """The student-safe missing list: concept `name` + `correct_conception`.

    Plan D2/D4: the student never sees the misconception label nor any score, so
    the stored `concept_id`/`score` are dropped here. The list is already capped
    by the writer; `limit` is a belt-and-braces guard. Pure — no DB, no network.
    """
    raw = (breakdown or {}).get('missing_concepts')
    out = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict) or not item.get('name'):
                continue
            out.append({
                'name': item.get('name'),
                'correct_conception': item.get('correct_conception'),
            })
            if len(out) >= limit:
                break
    return out


def catalog_match_surface(breakdown):
    """The lecturer-facing catalogue result, or `None` when nothing was mapped.

    A `matched` result exposes the misconception label + score; a `no_match`
    result exposes the top-3 candidate concepts with their scores and, for the
    override control, each candidate concept's misconception options (plan D3 /
    D5). A `None`/`no_match` never invents a label.
    """
    match = (breakdown or {}).get('catalog_match')
    if not isinstance(match, dict):
        return None

    candidates_raw = [
        c for c in (match.get('candidates') or []) if isinstance(c, dict)]
    concept_ids = [c.get('concept_id') for c in candidates_raw]
    names = _concept_names(concept_ids)
    options_by_concept = _concept_misconceptions(concept_ids)

    candidates = []
    for c in candidates_raw:
        cid = str(c['concept_id']) if c.get('concept_id') else None
        candidates.append({
            'concept_id': cid,
            'name': names.get(cid) or None,
            'score': c.get('score'),
            'misconceptions': options_by_concept.get(cid, []) if cid else [],
        })

    status = match.get('status')
    return {
        'status': status,
        'score': match.get('score'),
        'misconception_id': match.get('misconception_id'),
        'label': (_misconception_label(match.get('misconception_id'))
                  if status == 'matched' else None),
        'concept_id': match.get('concept_id'),
        'concept_name': match.get('concept_name'),
        'candidates': candidates,
    }


def _grounding_detail(analysis, breakdown: dict, include_catalog=True) -> dict:
    """Assemble the reference/material block exposed to the lecturer UI.

    Stable shape across prompt versions. `references` is the provenance of the
    generated reading material (D10) and is kept in C8 — it is not a verdict's
    citation list. C8 removed the superseded grounding keys
    (`grounding_similarity`, `grounding_payload` and the nested `grounding`
    block); their DB columns stay so historical rows remain interpretable. C6
    adds the generated `reading_material` block (or `None`).

    Phase 6 adds the catalogue surfaces. `include_catalog=False` is used by the
    student-slice builder, which must never expose the mapping (label, score,
    candidates) — see `views._student_analysis_detail`.
    """
    detail = {
        'concept_breakdown_json': breakdown,
        'references': _attach_document_titles(breakdown.get('references') or []),
        'what_should_be_learned': breakdown.get('what_should_be_learned') or [],
        'suggested_materials': analysis.suggested_materials_json or [],
        # v3.2: the sentence-level anchor to the misconception, as stored (with
        # its `status`), or None. Lecturer surfaces show it unconditionally.
        'evidence_span': breakdown.get('evidence_span'),
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
        # Phase 6: the catalogue mapping (label + score, or the no-match
        # candidates) and the missing-concept list. Student-slice callers pass
        # `include_catalog=False` so neither reaches the student surface.
        'catalog_match': catalog_match_surface(breakdown) if include_catalog else None,
        'missing_concepts': missing_concepts_surface(breakdown),
    }
    return detail


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
                'original_category': existing.original_category,
                'final_category': existing.final_category,
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


class QuestionVersionMisconceptionLinkView(APIView):
    """The optional authoring path (plan D5) — link a misconception to a question.

    Confirming a catalogue match (or overriding it) stores the lecturer's chosen
    misconception in `question_version_misconceptions`. Idempotent: the link
    table's primary key is `(question_version_id, misconception_id)`, so a
    repeated link is a no-op and no text is ever typed. The link narrows the
    catalogue candidate set the next time the question is analysed
    (`catalog_mapping.question_version_concept_ids`).
    """

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request, version_id):
        misconception_id = request.data.get('misconception_id')
        try:
            misconception_id = str(uuid.UUID(str(misconception_id)))
        except (TypeError, ValueError):
            return Response(
                {'detail': 'misconception_id tidak valid.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT qs.subject_id
                FROM question_versions qv
                JOIN questions q ON q.id = qv.question_id
                JOIN question_sets qs ON qs.id = q.question_set_id
                WHERE qv.id = %s
                """,
                [str(version_id)],
            )
            row = cur.fetchone()
        if not row:
            return Response(
                {'detail': 'Versi soal tidak ditemukan.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        if not is_lecturer_for_subject(request.user, row[0]):
            return Response(
                {'detail': 'Anda tidak berwenang mengubah soal ini.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO question_version_misconceptions
                        (question_version_id, misconception_id)
                    VALUES (%s, %s)
                    ON CONFLICT (question_version_id, misconception_id) DO NOTHING
                    """,
                    [str(version_id), misconception_id],
                )
                linked = cur.rowcount > 0
        except IntegrityError:
            return Response(
                {'detail': 'Miskonsepsi tidak ditemukan.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({
            'question_version_id': str(version_id),
            'misconception_id': misconception_id,
            'linked': linked,
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
                        final_category = data.get('final_category') or None
                        try:
                            # Migration 0031: record the diagnosis itself. The tier level is
                            # a lossy projection of it (FP and MSC are both level 2), so it
                            # cannot be the only thing stored.
                            with transaction.atomic():
                                # The savepoint is load-bearing: the CALL is inside the
                                # outer transaction, and a failed statement would otherwise
                                # poison it and make the fallback below fail too.
                                cursor.execute(
                                    'CALL sp_validate_analysis(%s, %s, %s, %s, %s, %s, %s, %s, NULL);',
                                    [
                                        str(a.id),
                                        str(request.user.id),
                                        data['status'],
                                        data.get('final_percentage'),
                                        data.get('final_tier_level'),
                                        final_feedback,
                                        data.get('notes') or None,
                                        final_category,
                                    ],
                                )
                                row = cursor.fetchone()
                        except ProgrammingError:
                            # Deploy window: this code is serving while migration 0031 has
                            # not been applied yet, because deploy.sh builds and starts the
                            # new containers *before* it runs `manage.py migrate`. Degrade
                            # to the 7-arg procedure rather than failing a lecturer's
                            # submission; the category is then backfilled from the analysis.
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

        # S1: the lecturer's verdict decides which category's material the student is
        # served (brief S-D1/S-D2). Runs after commit, so a rolled-back validation never
        # leaves a PENDING row. `enqueue_reading_material` is idempotent and returns
        # False for SC, so a Salah verdict with an unchanged category is a no-op.
        if data['status'] != 'REJECTED':
            val = Validation.objects.filter(analysis=a).first()
            if val and val.final_percentage is not None and float(val.final_percentage) < 99.9:
                category = lecturer_category(a, val.final_tier_level_snapshot, val.final_category)
                if category:
                    enqueue_reading_material(a.submission.question_version_id, category)

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


def _analysis_metrics(analyses):
    """Analysis-property aggregates (C5; the grounding block left in C8).

    Answer similarity measures alignment with the **lecturer's reference
    answer**; it needs no lecturer validation and is NOT accuracy. The verdict
    is driven by the LLM, with the θ-based rule recorded in shadow, so
    `verdict_agreement_rate` is a diagnostic (how often the two disagree), not a
    quality score. `reading_material_counts` is the drain backlog.

    C8 (D17) removed the superseded grounding (citation-fidelity) block: its
    input (`student_feedback`) left in the same commit, so a mean recomputed
    from the residue would silently redefine the retained metric. The
    `llm_analyses.grounding_*` columns stay for history; only the API surface
    goes. All aggregates are computed over **all current analyses in scope**,
    model-filter-aware.
    """
    question_version_ids = _analysis_question_version_ids(analyses)
    return {
        **_answer_similarity_metrics(analyses),
        'reading_material_counts': _reading_material_counts(question_version_ids),
    }


def _compute_metrics(scored, all_validations):
    """Agreement metrics over scored (ACCEPTED/EDITED) validations.

    Returns the validation-derived payload only; `all_validations` feeds the
    rejection-rate denominator. Grounding keys are NOT merged here — they are
    computed from all current analyses in scope (see `_analysis_metrics` /
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
    'Answer similarity = cosine(jawaban siswa, jawaban referensi dosen), diukur terhadap jawaban '
    'referensi dosen, tidak memerlukan validasi dosen, dan BUKAN akurasi. '
    'Verdict digerakkan oleh LLM; aturan berbasis θ (theta) dicatat sebagai shadow dan tidak '
    'menggerakkan kategori mana pun. verdict_agreement_rate mengukur seberapa sering kedua verdict '
    'berbeda — ini diagnostik, bukan skor kualitas, dan kalibrasi dilakukan terhadap dosen, '
    'bukan terhadap LLM.'
)


def _scope_analyses(user, subject_id=None, model_filter=None):
    """All CURRENT analyses in the caller's subject scope (analysis-metric source).

    Answer similarity is a property of the analysis and needs no lecturer
    validation, so it is computed over every current analysis in scope — not
    only the ones that happen to have a validation. A number that only appears
    (or changes) after a validation would be useless as a pre-validation signal.

    Scope = lecturer subject scope (superuser: all) + optional `?subject_id=` +
    optional `?model=`. The model filter must narrow the block too, or
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

    Validation-derived fields come from `validation_rows`; the answer-similarity
    and shadow-agreement keys come from `analysis_rows` (that model's current
    analyses in scope), so a model with analyses but no validations still
    reports them. C8 removed the superseded grounding keys from this row — the
    DB columns stay, but the API no longer exposes them.

    C5F (D16 — calibrate per model): the answer-similarity keys and the
    shadow-vs-LLM agreement keys are computed from the SAME `analysis_rows`
    list, not read from a fresh query — the R5F bug was a second query that
    bypassed the model filter. "A θ fitted on one model does not transfer to
    another", so every number the per-model calibration reads has to live on
    the row.
    """
    scored = [v for v in validation_rows if v.status in ('ACCEPTED', 'EDITED')]
    m = _compute_metrics(scored, validation_rows)
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
    """Payload when no validations exist yet: analysis metrics are still reported.

    Validation-derived metrics stay absent (no invented zeros); the C5
    answer-similarity/agreement/reading-material keys and one `by_model` row per
    model present in scope are always returned. The superseded grounding keys
    left the payload in C8.
    """
    identifiers = sorted({a.model_identifier for a in analyses})
    by_model = [
        _by_model_row(identifier, [], [a for a in analyses if a.model_identifier == identifier])
        for identifier in identifiers
    ]
    payload = {
        'total_validations': 0,
        'message': 'Belum ada data validasi — answer similarity tetap dihitung dari analisis; '
                   'metrik kesesuaian dengan dosen tersedia setelah dosen memvalidasi analisis.',
        **_analysis_metrics(analyses),
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
    - answer similarity (alignment with the lecturer's reference answer), the
      shadow-vs-LLM verdict agreement and the reading-material status counts.
      These are properties of the ANALYSIS and need no lecturer validation; they
      are source-alignment, NOT accuracy. They are computed over all current
      analyses in scope — not only the ones that have a validation — so the
      numbers are available as a pre-validation signal and never change just
      because a validation appears. The superseded grounding block left in C8.

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

        # Analysis-metric source: all current analyses in scope (no validation
        # needed), narrowed by ?subject_id= and ?model= so the filter restricts
        # the block.
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
        payload.update(_analysis_metrics(analyses))

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
