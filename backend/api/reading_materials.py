"""Reading-material generation + queue helpers (Phase C4).

The analysis path never generates material: it only inserts a cheap `PENDING`
row into `generated_reading_materials` (`enqueue_reading_material`) so a long
generation completion can never sit inside an `ANALYZING` window and push a live
submission past `analyze_submissions.py`'s 10-minute zombie re-claim.

The real work lives in `generate_reading_material(ctx, category)`, driven by
`manage.py drain_reading_materials`. It retrieves reference chunks exactly as R3
does (`llm.retrieve_reference_chunks`), asks the model for a Markdown reading
paragraph plus the chunks it used, and filters `sources[]` to chunk ids that were
actually in the retrieved set. The residue is counted into
`ungrounded_source_count` — the only detector standing in for the human backstop
that D7 removes.

Every failure is non-fatal: a generation failure marks the row `FAILED` and is
retried by the drain up to `READING_MATERIAL_MAX_RUNS`. It must never raise into
the caller and never fail an analysis.

No material for `SC` (D6): `enqueue_reading_material` skips it and the table's
`CHECK (category IN ('LK','FP','FN','MSC'))` enforces it in the schema.
"""

import hashlib
import json
import logging

from django.conf import settings
from django.db import connection

from api.llm import (
    FourTierContext,
    _call_llm_json,
    build_reference_block,
    get_active_model_identifier,
    retrieve_reference_chunks,
)

logger = logging.getLogger(__name__)

# Recorded on every generated row; distinguishes material generations from the
# analysis prompt versions when the C5/C6 metrics group by prompt version.
READING_MATERIAL_PROMPT_VERSION = 'reading-material-v1.0'

# Only these categories get material (D6). Kept as a constant so the skip is
# testable and the schema CHECK and the code agree.
MATERIAL_CATEGORIES = ('LK', 'FP', 'FN', 'MSC')

_SYSTEM_PROMPT = (
    "Anda adalah penulis materi bacaan (reading material) untuk mahasiswa pada asesmen Four-Tier.\n"
    "Tugas: tulis materi bacaan dalam Bahasa Indonesia formal yang membantu mahasiswa "
    "memperbaiki kesalahan konsep pada kategori yang diberikan.\n"
    "ATURAN SUMBER:\n"
    "1. Gunakan HANYA kutipan pada bagian SUMBER REFERENSI untuk setiap klaim faktual.\n"
    "2. Bila bagian SUMBER REFERENSI kosong, tulis materi dari pengetahuan Anda sendiri.\n"
    "3. Setiap chunk_id pada \"sources\" WAJIB berasal dari SUMBER REFERENSI.\n"
    "Kembalikan HANYA format JSON valid:\n"
    "{\n"
    '  "reading_material_md": "<materi dalam format Markdown>",\n'
    '  "sources": [{"chunk_id": "<uuid>", "document_id": "<uuid>", '
    '"document_title": "<judul>", "page": <nomor>}]\n'
    "}"
)


def input_fingerprint(prompt_version, model_identifier, question_version_id, category,
                      prompt, ref_short, ref_reason) -> str:
    """sha256 (64-char lowercase hex) over the inputs that define the artifact.

    A pass whose fingerprint matches skips generation entirely. Corpus drift is
    deliberately **not** covered here — hashing chunk ids would require the very
    retrieval call the fingerprint exists to avoid; the ingest-side hook marks
    those rows `STALE` instead (D13).
    """
    parts = [
        str(prompt_version or ''),
        str(model_identifier or ''),
        str(question_version_id or ''),
        str(category or ''),
        str(prompt or ''),
        str(ref_short or ''),
        str(ref_reason or ''),
    ]
    payload = '\x1f'.join(parts)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def enqueue_reading_material(question_version_id, category) -> bool:
    """Insert a `PENDING` row unless one already exists for the bucket.

    **No LLM call.** Cheap enough to run inline at the end of an analysis. Returns
    `True` when a row was created, `False` when one already existed or the
    category is `SC` (D6 — no material for a fully-correct confident student).
    """
    if category == 'SC':
        return False
    with connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO generated_reading_materials (question_version_id, category, status)
            VALUES (%s, %s, 'PENDING')
            ON CONFLICT (question_version_id, category) DO NOTHING
            """,
            [question_version_id, category],
        )
        return cur.rowcount > 0


def load_question_version_context(question_version_id) -> FourTierContext:
    """Build a `FourTierContext` for a question version (no submission).

    Mirrors the effective-reference resolution `llm.load_context` applies —
    `question_versions.short_answer` / `.model_answer` preferred, falling back to
    the `reference_answers` mirror rows — so the fingerprint and the prompt see
    the same reference text an analysis would.
    """
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT qv.id, qv.prompt, COALESCE(qv.short_answer, ''), qv.model_answer,
                   qs.subject_id, qs.topic_id
            FROM question_versions qv
            JOIN questions q ON q.id = qv.question_id
            JOIN question_sets qs ON qs.id = q.question_set_id
            WHERE qv.id = %s
            """,
            [question_version_id],
        )
        row = cur.fetchone()
        if not row:
            raise ValueError(f'Question version {question_version_id} not found')

        cur.execute(
            """
            SELECT answer_key, answer_text
            FROM reference_answers
            WHERE question_version_id = %s AND answer_key IN ('JAWABAN_SINGKAT', 'ALASAN')
            """,
            [question_version_id],
        )
        mirror = {r[0]: (r[1] or '') for r in cur.fetchall()}

    qv_id, prompt, short_answer, model_answer, subject_id, topic_id = row
    reference_short_answer = (
        (short_answer or '').strip()
        or (mirror.get('JAWABAN_SINGKAT') or '').strip()
        or ''
    )
    reference_reason = (
        (model_answer or '').strip()
        or (mirror.get('ALASAN') or '').strip()
        or ''
    )

    return FourTierContext(
        submission_id='',
        subject_id=str(subject_id),
        status='',
        tier1_answer='',
        tier2_confidence=1,
        tier3_reason='',
        tier4_confidence=1,
        heuristic_flags=[],
        question_prompt=prompt or '',
        short_answer=short_answer or '',
        model_answer=model_answer or '',
        reference_short_answer=reference_short_answer,
        reference_reason=reference_reason,
        set_title='',
        misconceptions=[],
        rejection_notes='',
        prior_explanation='',
        topic_id=str(topic_id) if topic_id else None,
        question_version_id=str(qv_id),
    )


def _filter_sources(raw_sources, retrieved_by_id):
    """Filter the LLM's `sources[]` to chunk ids actually in the retrieved set.

    Returns `(sources, ungrounded_count)`. Every kept source is re-materialised
    from the retrieved chunk (id / document id / title / page) so the stored
    provenance cannot contain a title or page the model invented. A cited id that
    is missing, malformed, or not in the retrieved set increments the residue.
    """
    sources = []
    ungrounded = 0
    seen = set()
    if not isinstance(raw_sources, list):
        return sources, ungrounded
    for item in raw_sources:
        if not isinstance(item, dict):
            ungrounded += 1
            continue
        raw_id = item.get('chunk_id')
        cid = str(raw_id) if raw_id is not None else ''
        if not cid:
            ungrounded += 1
            continue
        if cid in seen:
            continue
        seen.add(cid)
        chunk = retrieved_by_id.get(cid)
        if chunk is None:
            ungrounded += 1
            continue
        sources.append({
            'chunk_id': cid,
            'document_id': chunk.get('document_id'),
            'document_title': chunk.get('document_title', ''),
            'page': chunk.get('page_start'),
        })
    return sources, ungrounded


def _mark_ready(question_version_id, category, *, content_md, sources, grounded,
                ungrounded_source_count, input_fingerprint_value, model_identifier):
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE generated_reading_materials
            SET status = 'READY', content_md = %s, sources_json = %s::jsonb,
                grounded = %s, ungrounded_source_count = %s, input_fingerprint = %s,
                error = NULL, model_identifier = %s, prompt_version = %s,
                attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
            WHERE question_version_id = %s AND category = %s
            """,
            [
                content_md,
                json.dumps(sources, ensure_ascii=False),
                grounded,
                ungrounded_source_count,
                input_fingerprint_value,
                (model_identifier or '')[:100],
                READING_MATERIAL_PROMPT_VERSION,
                question_version_id,
                category,
            ],
        )


def _mark_failed(question_version_id, category, error):
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE generated_reading_materials
            SET status = 'FAILED', error = %s, attempts = attempts + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE question_version_id = %s AND category = %s
            """,
            [str(error)[:4000], question_version_id, category],
        )


def generate_reading_material(ctx, category) -> dict:
    """Generate (or regenerate) one `(question_version, category)` artifact.

    Retrieval, the model call and the write are all wrapped: a failure marks the
    row `FAILED` (with `error`, `attempts += 1`) and **never raises into the
    caller**. `temperature = settings.READING_MATERIAL_TEMPERATURE` (0.0) — not
    the pipeline's 0.1. Zero retrieved chunks still produce material, marked
    `grounded = False` and `sources = []` (D8).
    """
    question_version_id = getattr(ctx, 'question_version_id', None)
    model_identifier = get_active_model_identifier()
    fingerprint = input_fingerprint(
        READING_MATERIAL_PROMPT_VERSION, model_identifier, question_version_id,
        category, ctx.question_prompt, ctx.reference_short_answer, ctx.reference_reason,
    )

    retrieval_query = (
        f"{ctx.question_prompt}\n{ctx.reference_short_answer}\n{ctx.reference_reason}"
    ).strip()

    try:
        chunks = retrieve_reference_chunks(
            ctx.subject_id, ctx.topic_id, retrieval_query,
        )
        retrieved_by_id = {c['chunk_id']: c for c in chunks}

        reference_block = build_reference_block(chunks)
        user_prompt_parts = []
        if reference_block:
            user_prompt_parts.append(reference_block)
        user_prompt_parts.append(
            f"Kategori kesalahan mahasiswa: {category}\n\n"
            f"Pertanyaan:\n{ctx.question_prompt}\n\n"
            f"Jawaban Singkat Referensi: {ctx.reference_short_answer}\n"
            f"Alasan Referensi: {ctx.reference_reason}\n\n"
            "Tulis materi bacaan yang menutup kesalahan konsep pada kategori di atas."
        )
        user_prompt = '\n\n'.join(user_prompt_parts)

        data = _call_llm_json(
            _SYSTEM_PROMPT, user_prompt, model_identifier,
            temperature=settings.READING_MATERIAL_TEMPERATURE,
        )

        content_md = str(data.get('reading_material_md') or '').strip()
        sources, ungrounded = _filter_sources(data.get('sources'), retrieved_by_id)
        # D8: grounded is False exactly when no reference material was available.
        grounded = bool(chunks)

        _mark_ready(
            question_version_id, category,
            content_md=content_md,
            sources=sources,
            grounded=grounded,
            ungrounded_source_count=ungrounded,
            input_fingerprint_value=fingerprint,
            model_identifier=model_identifier,
        )
        return {
            'status': 'READY',
            'grounded': grounded,
            'sources_count': len(sources),
            'ungrounded_source_count': ungrounded,
            'chunks_retrieved': len(chunks),
        }
    except Exception as e:  # noqa: BLE001 — generation must never raise
        logger.warning(
            'Reading-material generation failed for %s/%s (non-fatal): %s',
            question_version_id, category, e,
        )
        try:
            _mark_failed(question_version_id, category, f'{type(e).__name__}: {e}')
        except Exception as mark_err:  # noqa: BLE001 — even the failure write is non-fatal
            logger.error(
                'Could not mark reading material FAILED for %s/%s: %s',
                question_version_id, category, mark_err,
            )
        return {'status': 'FAILED', 'error': str(e)}


def mark_stale_for_question_version(question_version_id) -> int:
    """Mark a question version's material rows `STALE` (ORM save hook, D13)."""
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE generated_reading_materials
            SET status = 'STALE', updated_at = CURRENT_TIMESTAMP
            WHERE question_version_id = %s AND status IN ('READY', 'PENDING')
            """,
            [question_version_id],
        )
        return cur.rowcount


def mark_stale_for_subject(subject_id) -> int:
    """Mark every material row of a subject `STALE` (corpus changed, D13)."""
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE generated_reading_materials AS m
            SET status = 'STALE', updated_at = CURRENT_TIMESTAMP
            FROM question_versions qv
            JOIN questions q ON q.id = qv.question_id
            JOIN question_sets qs ON qs.id = q.question_set_id
            WHERE m.question_version_id = qv.id
              AND qs.subject_id = %s
              AND m.status IN ('READY', 'PENDING')
            """,
            [subject_id],
        )
        return cur.rowcount
