"""Four-Tier AI Diagnostic Pipeline (v2.7 - Direct Model Evaluation & Structured Feedback).

1. Heuristic Pre-Check (Rules Engine, Non-AI):
   - t1_berisi_alasan: Tier 1 memuat kata sebab ('karena', 'sebab', dll.)
   - t3_kosong: Tier 3 kosong atau < 5 kata
   - t3_redundan: Tier 3 hanya menyalin ulang isi Tier 1 tanpa penurunan baru
   - t3_hafalan: Tier 3 hanya mengutip nama/bunyi hukum tanpa penerapan variabel/matematika

2. Direct Modular AI Grading (Bebas Rubrik 40/30/30):
   - Module A: Menilai kesimpulan Tier 1 (maks 120 karakter) -> BENAR / BENAR_SEBAGIAN / SALAH
   - Module B: Menilai alasan Tier 3 langsung terhadap Jawaban Model -> BENAR / SALAH
               (C8/D17: verdict-only; citation provenance via referensi/what_should_be_learned).
   - Module C: Klasifikasi tipe miskonsepsi jika Modul B bernilai SALAH.

3. Deterministic Decision Matrix (16 Rules):
   - Memetakan kombinasi (T1, T2, T3, T4) ke kategori SC, LK, FP, FN, MSC.

4. Binary All-or-Nothing Percentage Scoring:
   - Tier 1 BENAR dan Tier 3 BENAR -> 100.00% (Benar)
   - Salah satu salah -> 0.00% (Salah)
"""

import dataclasses
import json
import logging
import re
import time
from dataclasses import dataclass, field
from decimal import Decimal

from django.conf import settings
from django.db import connection
from openai import OpenAI

from api.embeddings import (
    EmbeddingError,
    answer_similarity,
    cosine,
    embed_text,
    vector_literal,
)

logger = logging.getLogger(__name__)

# Source-derived so metrics never pool a judged run with a shadow run: the
# source selects the bucket, and `llm_analyses.prompt_version` records it per
# row. The pre-C3 rows stay in their own `four-tier-v2.9-rag` bucket.
PROMPT_VERSION = f'four-tier-v3.0-{settings.TIER_VERDICT_SOURCE}'
LLM_TEMPERATURE = 0.1
LLM_MAX_RETRIES = 2

CATEGORY_TO_LEVEL = {
    'SC': 4,
    'FN': 3,
    'FP': 2,
    'MSC': 2,
    'LK': 1,
}

# 16-Row Deterministic Decision Matrix (T1, T2_is_yakin, T3, T4_is_yakin)
MATRIX_RULES = {
    ('B', True,  'B', True):  ('SC',  'Paham konsep utuh',                   'RENDAH'),
    ('B', True,  'B', False): ('LK',  'Benar, ragu pada penalaran',          'SEDANG_RENDAH'),
    ('B', False, 'B', True):  ('LK',  'Benar, ragu pada jawaban',            'SEDANG_RENDAH'),
    ('B', False, 'B', False): ('LK',  'Indikasi menebak',                    'SEDANG_RENDAH'),
    ('B', True,  'S', True):  ('FP',  'Jawaban benar menutupi miskonsepsi',   'TERTINGGI'),
    ('B', True,  'S', False): ('LK',  'Penalaran salah tapi ragu',           'SEDANG_RENDAH'),
    ('B', False, 'S', True):  ('LK',  'Pola tidak konsisten',                'SEDANG_RENDAH'),
    ('B', False, 'S', False): ('LK',  'Pengetahuan lemah',                   'SEDANG_RENDAH'),
    ('S', True,  'B', True):  ('FN',  'Penalaran benar, jawaban keliru',     'SEDANG'),
    ('S', True,  'B', False): ('LK',  'Tidak konsisten',                     'SEDANG_RENDAH'),
    ('S', False, 'B', True):  ('LK',  'Tidak konsisten',                     'SEDANG_RENDAH'),
    ('S', False, 'B', False): ('LK',  'Pengetahuan lemah',                   'SEDANG_RENDAH'),
    ('S', True,  'S', True):  ('MSC', 'Miskonsepsi penuh, diyakini',         'TINGGI'),
    ('S', True,  'S', False): ('LK',  'Salah tapi ragu',                     'SEDANG_RENDAH'),
    ('S', False, 'S', True):  ('LK',  'Salah tapi ragu',                     'SEDANG_RENDAH'),
    ('S', False, 'S', False): ('LK',  'Tidak paham konsep',                  'SEDANG_RENDAH'),
}

INTERVENTIONS = {
    'FP': (
        "Fokus Klarifikasi: Mahasiswa memperoleh jawaban akhir yang benar, tetapi alasan atau proses berpikir yang digunakan masih kurang tepat. "
        "Dosen disarankan menggali kembali cara berpikir mahasiswa melalui pertanyaan pemantik agar mahasiswa menyadari dan memperbaiki kesalahan penalarannya."
    ),
    'MSC': (
        "Fokus Remediasi Konsep: Mahasiswa memiliki pemahaman konsep yang keliru dan meyakininya sebagai konsep yang benar. "
        "Dosen disarankan membantu membangun ulang pemahaman mahasiswa melalui contoh pembanding, eksperimen sederhana, simulasi, atau penjelasan konsep yang lebih mendalam."
    ),
    'FN': (
        "Fokus Perbaikan Penalaran: Mahasiswa sudah memahami konsep dan langkah analisis dengan baik, tetapi masih kurang tepat dalam menarik kesimpulan akhir. "
        "Dosen cukup memberikan arahan untuk membantu mahasiswa memeriksa kembali hubungan antara proses berpikir dan hasil kesimpulannya."
    ),
    'LK': (
        "Fokus Penguatan Dasar: Mahasiswa masih mengalami kesulitan dalam memahami konsep dasar atau belum memiliki keyakinan yang cukup terhadap jawabannya. "
        "Dosen disarankan mengarahkan mahasiswa untuk meninjau kembali definisi, prinsip dasar, dan contoh penerapan konsep terkait."
    ),
    'SC': (
        "Fokus Pengembangan Lanjutan: Mahasiswa menunjukkan pemahaman konsep yang baik dan mampu memberikan penalaran yang konsisten. "
        "Tidak diperlukan tindakan remediasi; mahasiswa dapat diberikan tantangan lanjutan berupa soal analisis, penerapan konsep, atau eksplorasi materi yang lebih kompleks."
    ),
}


class LlmAnalysisError(Exception):
    pass


def get_llm_client() -> OpenAI:
    return OpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.LLM_API_KEY,
        timeout=getattr(settings, 'LLM_TIMEOUT', 120.0),
    )


def get_active_model_identifier() -> str:
    """Use the admin-approved model, with the deployment setting as a safe fallback."""
    try:
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT m.identifier
                FROM ai_runtime_settings s
                JOIN llm_models m ON m.id = s.active_model_id
                WHERE s.id = TRUE AND m.is_enabled = TRUE AND m.deprecated_at IS NULL
                """
            )
            row = cur.fetchone()
            if row and row[0]:
                return row[0]
    except Exception:
        logger.warning('Tidak dapat membaca konfigurasi model AI; memakai model deployment.', exc_info=True)
    return settings.LLM_MODEL


# ----------------------------------------------------------------------------
# 1. Deterministic Heuristic Pre-Checks
# ----------------------------------------------------------------------------

CAUSAL_WORDS_REGEX = re.compile(
    r'\b(karena|sebab|dikarenakan|oleh karena itu|akibatnya|maka dari itu|karna)\b', re.IGNORECASE
)

HAFALAN_WORDS_REGEX = re.compile(
    r'\b(bunyi hukum|menurut hukum|definisi hukum)\b', re.IGNORECASE
)


def compute_heuristic_flags(tier1: str, tier3: str) -> list[str]:
    flags = []
    t1 = (tier1 or '').strip()
    t3 = (tier3 or '').strip()
    words_t3 = t3.split()

    if CAUSAL_WORDS_REGEX.search(t1):
        flags.append('t1_berisi_alasan')

    if len(words_t3) < 5:
        flags.append('t3_kosong')

    clean_t1 = re.sub(r'[^\w\s]', '', t1).lower().strip()
    clean_t3 = re.sub(r'[^\w\s]', '', t3).lower().strip()
    if clean_t1 and clean_t3:
        if clean_t1 == clean_t3 or (clean_t1 in clean_t3 and len(clean_t3) <= len(clean_t1) + 6):
            flags.append('t3_redundan')

    has_law_quote = bool(HAFALAN_WORDS_REGEX.search(t3))
    has_math_or_derivation = bool(re.search(r'[=+\-*/<>]|\d', t3))
    if has_law_quote and not has_math_or_derivation and len(words_t3) < 12:
        flags.append('t3_hafalan')

    return flags


# ----------------------------------------------------------------------------
# 2. Context Loading
# ----------------------------------------------------------------------------

@dataclass
class FourTierContext:
    submission_id: str
    subject_id: str
    status: str
    tier1_answer: str
    tier2_confidence: int
    tier3_reason: str
    tier4_confidence: int
    heuristic_flags: list[str]
    question_prompt: str
    short_answer: str
    model_answer: str
    reference_short_answer: str
    reference_reason: str
    set_title: str
    misconceptions: list      # [{id, label, description}]
    rejection_notes: str
    prior_explanation: str
    topic_id: str | None = None
    question_version_id: str | None = None
    reference_chunks: list = field(default_factory=list)  # retrieved reference passages
    reference_t1_vec: list | None = None  # cached JAWABAN_SINGKAT embedding (C2)
    reference_t3_vec: list | None = None  # cached ALASAN embedding (C2)


def load_context(submission_id: str) -> FourTierContext:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.subject_id, s.status,
                   COALESCE(s.tier1_answer, ''), COALESCE(s.tier2_confidence, 1),
                   COALESCE(s.tier3_reason, s.answer_text), COALESCE(s.tier4_confidence, 1),
                   COALESCE(s.heuristic_flags, '[]'::jsonb),
                   qv.prompt, qv.model_answer, COALESCE(qv.short_answer, ''), qs.title,
                   qs.topic_id
            FROM submissions s
            JOIN question_versions qv ON qv.id = s.question_version_id
            JOIN questions q ON q.id = qv.question_id
            JOIN question_sets qs ON qs.id = q.question_set_id
            WHERE s.id = %s
            """,
            [submission_id],
        )
        row = cur.fetchone()
        if not row:
            raise LlmAnalysisError(f'Submission {submission_id} not found')

        cur.execute(
            """
            SELECT m.id, m.label, m.description
            FROM question_version_misconceptions qvm
            JOIN misconceptions m ON m.id = qvm.misconception_id
            WHERE qvm.question_version_id = (
                SELECT question_version_id FROM submissions WHERE id = %s)
            """,
            [submission_id],
        )
        misconceptions = [
            {'id': str(r[0]), 'label': r[1], 'description': r[2]}
            for r in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT COALESCE(v.notes, ''), COALESCE(a.explanation, '')
            FROM llm_analyses a
            LEFT JOIN validations v ON v.analysis_id = a.id
            WHERE a.submission_id = %s
            ORDER BY a.run_number DESC
            LIMIT 1
            """,
            [submission_id],
        )
        prior = cur.fetchone() or ('', '')
        
        # Load reference answers for this question version
        # Get question version id from the first query result
        cur.execute(
            """
            SELECT qv.id, qv.short_answer, qv.model_answer
            FROM submissions s
            JOIN question_versions qv ON qv.id = s.question_version_id
            WHERE s.id = %s
            """,
            [submission_id],
        )
        qv_row = cur.fetchone()
        qv_id, qv_short_answer, qv_model_answer = qv_row
        
        cur.execute(
            """
            SELECT answer_key, answer_text, embedding::text
            FROM reference_answers
            WHERE question_version_id = %s AND answer_key IN ('JAWABAN_SINGKAT', 'ALASAN')
            """,
            [qv_id],
        )
        ref_answers = {}
        ref_vectors = {}
        for r in cur.fetchall():
            ref_answers[r[0]] = r[1]
            vec = _parse_vector(r[2])
            if vec:
                ref_vectors[r[0]] = vec

        # Use reference_answers as primary source, fall back to question_versions columns
        reference_short_answer = (qv_short_answer or '').strip() or ref_answers.get('JAWABAN_SINGKAT', '').strip() or ''
        reference_reason = (qv_model_answer or '').strip() or ref_answers.get('ALASAN', '').strip() or ''

    flags = row[7] if isinstance(row[7], list) else []

    return FourTierContext(
        submission_id=str(row[0]),
        subject_id=str(row[1]),
        status=row[2],
        tier1_answer=row[3],
        tier2_confidence=int(row[4]),
        tier3_reason=row[5],
        tier4_confidence=int(row[6]),
        heuristic_flags=flags,
        question_prompt=row[8],
        model_answer=row[9],
        short_answer=row[10],
        reference_short_answer=reference_short_answer,
        reference_reason=reference_reason,
        set_title=row[11],
        misconceptions=misconceptions,
        rejection_notes=(prior[0] or '')[:2000],
        prior_explanation=(prior[1] or '')[:2000],
        topic_id=str(row[12]) if row[12] else None,
        question_version_id=str(qv_id),
        reference_t1_vec=ref_vectors.get('JAWABAN_SINGKAT'),
        reference_t3_vec=ref_vectors.get('ALASAN'),
    )


# ----------------------------------------------------------------------------
# 3. LLM Caller Helper
# ----------------------------------------------------------------------------

def _extract_json(raw: str) -> dict:
    text = raw.strip()
    text = re.sub(r'^```(?:json)?', '', text, flags=re.MULTILINE)
    text = re.sub(r'```$', '', text, flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise LlmAnalysisError('LLM output is not valid JSON')


def _call_llm_json(system_prompt: str, user_prompt: str, model_identifier: str,
                   temperature: float | None = None) -> dict:
    client = get_llm_client()
    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_prompt},
    ]
    if temperature is None:
        temperature = LLM_TEMPERATURE
    last_error = None
    for attempt in range(LLM_MAX_RETRIES + 1):
        try:
            kwargs = {
                'model': model_identifier,
                'messages': messages,
                'temperature': temperature,
            }
            try:
                response = client.chat.completions.create(
                    response_format={'type': 'json_object'}, **kwargs
                )
            except Exception:
                response = client.chat.completions.create(**kwargs)
            raw = response.choices[0].message.content or ''
            return _extract_json(raw)
        except Exception as e:
            last_error = e
            if attempt < LLM_MAX_RETRIES:
                time.sleep(1.5 * (attempt + 1))
                continue
    raise LlmAnalysisError(f'LLM call failed after retries: {last_error}')


# ----------------------------------------------------------------------------
# 3b. Reference Retrieval + Citation Validation + Grounding (RAG)
# ----------------------------------------------------------------------------

CITATION_RULES = (
    'ATURAN SITASI:\n'
    '1. Anda HANYA boleh mengutip chunk_id yang tercantum di bagian SUMBER REFERENSI.\n'
    '2. Field "referensi" WAJIB berupa array objek {"chunk_id": "<uuid>", "kutipan": "<potongan kalimat>"}.\n'
    '3. Jika tidak ada kutipan yang relevan, kembalikan "referensi": [].'
)

REFERENSI_SCHEMA_LINE = '  "referensi": [{"chunk_id": "<uuid>", "kutipan": "<potongan kalimat>"}]'


def _parse_vector(text):
    """Parse a `vector` column read as text ('[0.1,0.2,...]') into floats."""
    if text is None:
        return None
    if isinstance(text, (list, tuple)):
        try:
            return [float(x) for x in text]
        except (TypeError, ValueError):
            return None
    try:
        return [float(x) for x in json.loads(text)]
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def retrieve_reference_chunks(subject_id, topic_id, query_text, k=None, threshold=None) -> list[dict]:
    """Retrieve the top-k reference passages for a subject (optionally a topic).

    Non-fatal by contract: any embedding/DB error is logged and yields `[]`, so
    an analysis always proceeds rubric-only (brief §8.2, HANDOFF rule 4).
    """
    if k is None:
        k = settings.RETRIEVAL_TOP_K
    if threshold is None:
        threshold = settings.RETRIEVAL_SIMILARITY_THRESHOLD
    try:
        query_vec = embed_text(query_text)
        with connection.cursor() as cur:
            # Only narrow by topic when that topic actually has chunks.
            effective_topic = None
            if topic_id:
                cur.execute(
                    """SELECT EXISTS(
                           SELECT 1 FROM knowledge_chunks
                           WHERE subject_id = %s AND topic_id = %s AND embedding IS NOT NULL
                       )""",
                    [subject_id, topic_id],
                )
                if cur.fetchone()[0]:
                    effective_topic = topic_id
            cur.execute(
                """SELECT chunk_id, document_id, chunk_index, content, token_count,
                          metadata_json, similarity
                   FROM fn_search_knowledge_chunks(
                       %s::uuid, %s::vector, %s::uuid, %s::int, %s::float)""",
                [subject_id, vector_literal(query_vec), effective_topic, k, threshold],
            )
            rows = cur.fetchall()
        if not rows:
            return []

        chunk_ids = [str(r[0]) for r in rows]
        doc_ids = sorted({str(r[1]) for r in rows})
        # fn_search_knowledge_chunks returns neither the embedding nor the
        # document title, so fetch both in a second query. Chunks are NEVER
        # re-embedded — the stored vector is the source of truth (rule 3).
        with connection.cursor() as cur:
            cur.execute(
                'SELECT id, embedding::text FROM knowledge_chunks WHERE id = ANY(%s)',
                [chunk_ids],
            )
            embeddings = {str(r[0]): _parse_vector(r[1]) for r in cur.fetchall()}
            cur.execute(
                'SELECT id, title FROM knowledge_documents WHERE id = ANY(%s)',
                [doc_ids],
            )
            titles = {str(r[0]): r[1] for r in cur.fetchall()}

        chunks = []
        for r in rows:
            cid = str(r[0])
            meta = r[5]
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except (TypeError, ValueError):
                    meta = {}
            if not isinstance(meta, dict):
                meta = {}
            chunks.append({
                'chunk_id': cid,
                'document_id': str(r[1]),
                'chunk_index': r[2],
                'content': r[3],
                'token_count': r[4],
                'metadata_json': meta,
                'similarity': float(r[6]),
                'embedding': embeddings.get(cid),
                'document_title': titles.get(str(r[1]), ''),
                'page_start': meta.get('page_start'),
            })
        return chunks
    except Exception as e:  # noqa: BLE001 — retrieval must never fail an analysis
        logger.warning('Reference retrieval failed for subject %s (non-fatal): %s', subject_id, e)
        return []


def build_reference_block(reference_chunks) -> str:
    """The SUMBER REFERENSI prompt block (brief §8.3). Empty when no chunks."""
    if not reference_chunks:
        return ''
    lines = ['SUMBER REFERENSI (Kutipan Buku Acuan — gunakan HANYA kutipan di bawah ini):']
    for i, chunk in enumerate(reference_chunks, start=1):
        page = chunk.get('page_start')
        lines.append(
            f'[S{i}] chunk_id={chunk.get("chunk_id")} | hal. {page} | {chunk.get("document_title", "")}'
        )
        lines.append(f'"{chunk.get("content", "")}"')
    return '\n'.join(lines)


def validate_citations(referensi, retrieved) -> list[dict]:
    """Validate the LLM's `referensi` against the retrieved chunks.

    `retrieved` is keyed by chunk_id. A citation is valid iff its chunk_id is in
    the retrieved set; invalid reasons are 'not_in_retrieved_set' or 'malformed'.
    Each entry carries the full audit shape (brief §8.5).
    """
    if not isinstance(referensi, list):
        referensi = []
    entries = []
    for ref in referensi:
        if not isinstance(ref, dict):
            entries.append({
                'chunk_id': '', 'document_id': None, 'page': None, 'quote': '',
                'similarity': None, 'valid': False, 'reason_if_invalid': 'malformed',
            })
            continue
        raw_id = ref.get('chunk_id')
        cid = str(raw_id) if raw_id is not None else ''
        quote = str(ref.get('kutipan', ''))
        if not cid:
            entries.append({
                'chunk_id': '', 'document_id': None, 'page': None, 'quote': quote,
                'similarity': None, 'valid': False, 'reason_if_invalid': 'malformed',
            })
            continue
        chunk = retrieved.get(cid)
        if chunk is None:
            entries.append({
                'chunk_id': cid, 'document_id': None, 'page': None, 'quote': quote,
                'similarity': None, 'valid': False, 'reason_if_invalid': 'not_in_retrieved_set',
            })
            continue
        entries.append({
            'chunk_id': cid,
            'document_id': chunk.get('document_id'),
            'page': chunk.get('page_start'),
            'quote': quote,
            'similarity': chunk.get('similarity'),
            'valid': True,
            'reason_if_invalid': None,
        })
    return entries


def grounded_similarity(citations, retrieved, advisory_text):
    """Cosine between the advisory text and each VALID cited chunk's embedding.

    Returns `(similarity_mean, similarity_max, citation_count)`. Zero valid
    citations → `(None, None, None)` and no extra embedding call. Otherwise
    exactly one extra embedding call (the advisory text). This measures
    alignment with the cited source — it is NOT an accuracy score.
    """
    valid = [c for c in citations if c.get('valid')]
    if not valid:
        return None, None, None
    advisory_vec = embed_text(advisory_text)
    cosines = []
    for citation in valid:
        chunk = retrieved.get(citation['chunk_id'])
        embedding = chunk.get('embedding') if chunk else None
        if embedding:
            cosines.append(cosine(advisory_vec, embedding))
    if not cosines:
        return None, None, None
    return sum(cosines) / len(cosines), max(cosines), len(cosines)


def _parse_referensi(raw) -> list[dict]:
    """Defensively parse the LLM `referensi` field (missing/non-dict dropped)."""
    out = []
    if not isinstance(raw, list):
        return out
    for item in raw:
        if not isinstance(item, dict):
            continue
        cid = item.get('chunk_id')
        if cid is None:
            continue
        out.append({'chunk_id': str(cid), 'kutipan': str(item.get('kutipan', ''))})
    return out


def _parse_what_should_be_learned(raw) -> list[dict]:
    """Defensively parse Modul B's `what_should_be_learned` list."""
    out = []
    if not isinstance(raw, list):
        return out
    for item in raw:
        if not isinstance(item, dict):
            continue
        topik = item.get('topik')
        if topik is None:
            continue
        sumber = item.get('sumber_chunk_ids')
        if not isinstance(sumber, list):
            sumber = []
        out.append({'topik': str(topik), 'sumber_chunk_ids': [str(s) for s in sumber]})
    return out


# ----------------------------------------------------------------------------
# 4. Modular AI Evaluation Modules
# ----------------------------------------------------------------------------

def run_module_a(ctx: FourTierContext, model_identifier: str) -> tuple[str, str]:
    """Modul A — Penilai Jawaban Singkat (Tier 1)."""
    sys_prompt = (
        "Anda adalah Modul A: Penilai Kesimpulan Jawaban (Tier 1) untuk asesmen Four-Tier.\n"
        "Tugas: Nilai ketepatan kesimpulan esai singkat mahasiswa (maks 120 karakter) terhadap Jawaban Model.\n"
        "Kembalikan HANYA format JSON valid:\n"
        "{\n"
        '  "score": "BENAR" | "BENAR_SEBAGIAN" | "SALAH",\n'
        '  "reasoning": "penjelasan singkat 1 kalimat dalam Bahasa Indonesia formal"\n'
        "}"
    )
    user_prompt = (
        f"Pertanyaan:\n{ctx.question_prompt}\n\n"
        f"Jawaban Singkat Acuan (Kunci):\n{ctx.reference_short_answer or ctx.reference_reason or ''}\n\n"
        f"Jawaban Singkat Mahasiswa (Tier 1):\n{ctx.tier1_answer}"
    )
    if ctx.rejection_notes:
        user_prompt += f"\n\n[CATATAN DOSEN PADA ANALISIS SEBELUMNYA]:\n{ctx.rejection_notes}"

    data = _call_llm_json(sys_prompt, user_prompt, model_identifier)
    score = str(data.get('score', '')).upper()
    if score not in ('BENAR', 'BENAR_SEBAGIAN', 'SALAH'):
        score = 'SALAH'
    return score, str(data.get('reasoning', ''))


def run_module_b(ctx: FourTierContext, model_identifier: str) -> tuple[str, list, list]:
    """Modul B — Penilai Alasan Ilmiah (Tier 3) langsung terhadap Model Answer.

    C8 (D17): Modul B is verdict-only. It no longer produces `student_feedback`
    or a lecturer `reasoning` string — the retained legacy `grounding_similarity`
    was built from `student_feedback['konsep_seharusnya']`, so the metric and its
    input leave in the same commit. The only extra output is the citation
    provenance (`referensi` / `what_should_be_learned`) when reference chunks
    were supplied.
    """
    sys_prompt = (
        "Anda adalah Modul B: Penilai Alasan & Penalaran Ilmiah (Tier 3).\n"
        "Tugas: Nilai apakah penjelasan/alasan mahasiswa (Tier 3) secara ilmiah BENAR atau SALAH secara langsung terhadap Jawaban Model.\n"
        "   - BENAR: Penalaran fisis valid, tepat secara konsep, atau penurunan matematis/aljabar langkah-demi-langkah valid dan membuktikan kesimpulan.\n"
        "   - SALAH: Terdapat miskonsepsi, prinsip fisis salah, rumus keliru, penalaran tidak logis, atau bertentangan dengan sains.\n"
        "   PANDUAN EVALUASI ILMIAH:\n"
        "   - Mahasiswa DIPERBOLEHKAN menyajikan alasan dalam bentuk penurunan rumus matematis ringkas jika langkah fisisnya benar.\n"
        "   - Tidak wajib menuliskan paragraf narasi panjang jika penurunan aljabar sudah tepat membuktikan kesimpulan.\n"
        "   - ANTI-HALUSINASI: Nilai hanya apa yang tertulis. Jangan mengarang langkah yang tidak ada di teks mahasiswa.\n\n"
        "Kembalikan HANYA format JSON valid:\n"
        "{\n"
        '  "score": "BENAR" | "SALAH"\n'
        "}"
    )
    reference_block = build_reference_block(ctx.reference_chunks)
    if reference_block:
        # Only when references exist do the schema and rules change; with no
        # references the prompt stays minimal.
        sys_prompt = sys_prompt.replace(
            '  "score": "BENAR" | "SALAH"\n}',
            '  "score": "BENAR" | "SALAH",\n'
            + REFERENSI_SCHEMA_LINE + ',\n'
            '  "what_should_be_learned": [{"topik": "...", "sumber_chunk_ids": ["<uuid>"]}]\n'
            "}",
        )
        sys_prompt += "\n\n" + CITATION_RULES

    user_prompt = (
        f"Pertanyaan:\n{ctx.question_prompt}\n\n"
        f"Jawaban Model (Acuan Kebenaran Sains):\nJawaban Singkat Referensi: {ctx.reference_short_answer or ctx.model_answer}\nAlasan Referensi: {ctx.reference_reason or ctx.model_answer}\n\n"
        f"Kesimpulan Mahasiswa di Tier 1:\n\"{ctx.tier1_answer}\"\n\n"
        f"Alasan/Penalaran Mahasiswa di Tier 3:\n\"{ctx.tier3_reason}\""
    )
    if reference_block:
        user_prompt = reference_block + "\n\n" + user_prompt
    if ctx.rejection_notes:
        user_prompt += f"\n\n[CATATAN DOSEN PADA ANALISIS SEBELUMNYA]:\n{ctx.rejection_notes}"

    data = _call_llm_json(sys_prompt, user_prompt, model_identifier)
    score = str(data.get('score', '')).upper()
    if score not in ('BENAR', 'SALAH'):
        score = 'SALAH'

    referensi = _parse_referensi(data.get('referensi'))
    what_should_be_learned = _parse_what_should_be_learned(data.get('what_should_be_learned'))

    return score, referensi, what_should_be_learned


def run_module_c(ctx: FourTierContext, model_identifier: str) -> tuple[str, str, float, str, list]:
    """Modul C — Klasifikasi Tipe Miskonsepsi dari Katalog."""
    misc_label_map = {str(m['id']): str(m['label']) for m in ctx.misconceptions}
    
    if ctx.misconceptions:
        misc_catalog = '\n'.join(
            f"- Nama Miskonsepsi: \"{m['label']}\" (ID: {m['id']}) — {m['description']}"
            for m in ctx.misconceptions
        )
    else:
        misc_catalog = "- Tidak ada katalog miskonsepsi khusus untuk butir ini."

    sys_prompt = (
        "Anda adalah Modul C: Klasifikasi Tipe Miskonsepsi Mahasiswa.\n"
        "Tugas: Baca teks gabungan Tier 1 (jawaban) dan Tier 3 (alasan). Identifikasi apakah ada pola miskonsepsi yang cocok dari katalog.\n"
        f"Daftar Tipe Miskonsepsi Terdaftar:\n{misc_catalog}\n"
        "Bila tidak ada yang cocok dari katalog atau mahasiswa sebenarnya menurunkan rumus dengan benar, gunakan kode 'MK-LAIN'.\n\n"
        "ATURAN BAHASA & KETELITIAN KETAT:\n"
        "1. DILARANG KERAS mengarang miskonsepsi palsu jika penalaran mahasiswa benar.\n"
        "2. Seluruh isi field 'reasoning' WAJIB ditulis murni dalam Bahasa Indonesia formal.\n"
        "3. Field 'misconception_name' WAJIB diisi Nama Label Miskonsepsi dari daftar, atau 'MK-LAIN'.\n\n"
        "Kembalikan HANYA format JSON valid:\n"
        "{\n"
        '  "misconception_code": "<id_atau_MK-LAIN>",\n'
        '  "misconception_name": "<nama_lengkap_label_miskonsepsi_atau_MK-LAIN>",\n'
        '  "confidence": 0.85,\n'
        '  "reasoning": "penjelasan evaluasi dalam Bahasa Indonesia"\n'
        "}"
    )
    reference_block = build_reference_block(ctx.reference_chunks)
    if reference_block:
        sys_prompt = sys_prompt.replace(
            '  "reasoning": "penjelasan evaluasi dalam Bahasa Indonesia"\n}',
            '  "reasoning": "penjelasan evaluasi dalam Bahasa Indonesia",\n'
            + REFERENSI_SCHEMA_LINE + '\n}',
        )
        sys_prompt += "\n\n" + CITATION_RULES

    user_prompt = (
        f"Pertanyaan:\n{ctx.question_prompt}\n\n"
        f"Jawaban Referensi (Singkat): {ctx.reference_short_answer or ''}\n"
        f"Alasan Referensi: {ctx.reference_reason or ''}\n\n"
        f"Teks Gabungan Mahasiswa:\n"
        f"Jawaban (Tier 1): {ctx.tier1_answer}\n"
        f"Alasan (Tier 3): {ctx.tier3_reason}"
    )
    if reference_block:
        user_prompt = reference_block + "\n\n" + user_prompt
    data = _call_llm_json(sys_prompt, user_prompt, model_identifier)
    code = str(data.get('misconception_code') or 'MK-LAIN').strip()
    
    raw_name = str(data.get('misconception_name') or '').strip()
    if raw_name and raw_name != code and not re.match(r'^[0-9a-f\-]{30,}$', raw_name, re.I):
        label_name = raw_name
    else:
        label_name = misc_label_map.get(code, code)
        
    try:
        conf = float(data.get('confidence', 0.8))
    except Exception:
        conf = 0.8
        
    return code, label_name, conf, str(data.get('reasoning', '')), _parse_referensi(data.get('referensi'))


# ----------------------------------------------------------------------------
# 5. Deterministic Mesin Aturan (16-Row Decision Matrix)
# ----------------------------------------------------------------------------

def evaluate_decision_matrix(
    t1_score: str,
    t2_confidence: int,
    t3_score: str,
    t4_confidence: int,
) -> tuple[str, str, str]:
    """Applies the deterministic matrix into pure 5 categories."""
    t1_norm = 'B' if t1_score == 'BENAR' else 'S'
    t2_yakin = t2_confidence >= 4
    t3_norm = 'B' if t3_score == 'BENAR' else 'S'
    t4_yakin = t4_confidence >= 4

    key = (t1_norm, t2_yakin, t3_norm, t4_yakin)
    return MATRIX_RULES.get(key, ('LK', 'Tidak konsisten', 'SEDANG_RENDAH'))


def _classify_one(similarity, threshold) -> str | None:
    if similarity is None:
        return None
    return 'BENAR' if similarity >= threshold else 'SALAH'


def classify_tiers(sim1, sim3, threshold_t1, threshold_t3) -> tuple[str | None, str | None]:
    """The theta-based rule verdict per tier. Pure: no DB, no network.

    `BENAR` iff `sim >= threshold`, else `SALAH`. A `None` similarity yields a
    `None` verdict — a missing measurement is not a judgement, so it must never
    be recorded as `SALAH` (the agreement metric counts only rows where both
    sides exist).
    """
    return (
        _classify_one(sim1, threshold_t1),
        _classify_one(sim3, threshold_t3),
    )


def _driving_verdicts(llm_t1, llm_t3, rule_t1, rule_t3) -> tuple[str, str]:
    """The verdict pair the matrix consumes (D11).

    Under the default `'llm'` this is the LLM's verdict — byte-identical to the
    pre-C3 behaviour. Under `'rule'` the shadow verdict drives, falling back to
    the LLM verdict on a tier the rule could not measure (a `None` rule verdict
    must never reach the matrix).
    """
    if settings.TIER_VERDICT_SOURCE == 'rule':
        return (
            rule_t1 if rule_t1 is not None else llm_t1,
            rule_t3 if rule_t3 is not None else llm_t3,
        )
    return llm_t1, llm_t3


# ----------------------------------------------------------------------------
# 6. Full Analysis Pipeline Execution
# ----------------------------------------------------------------------------

def analyze_submission(submission_id: str) -> str:
    """Runs the calibrated 4-tier pipeline for one submission."""
    started = time.monotonic()

    with connection.cursor() as cur:
        try:
            cur.execute('CALL sp_mark_submission_analyzing(%s);', [submission_id])
        except Exception as e:
            logger.warning('Gagal mengklaim submission %s: %s', submission_id, e)
            return 'SKIPPED'

    try:
        ctx = load_context(submission_id)
        # Resolve once so every module and the audit record use the same model.
        model_identifier = get_active_model_identifier()

        # Reference retrieval (non-fatal — a retrieval failure never fails an
        # analysis; the pipeline proceeds rubric-only, HANDOFF rule 4).
        retrieval_query = f"{ctx.question_prompt}\n{ctx.tier1_answer}\n{ctx.tier3_reason}"
        ctx.reference_chunks = retrieve_reference_chunks(
            ctx.subject_id, ctx.topic_id, retrieval_query
        )

        # Shadow answer-similarity + theta rule verdict (C3). Non-fatal and
        # optional: skipped entirely (zero embed calls) when SHADOW_RULE_VERDICT
        # is off. It is computed once for the submission, so both branches
        # (t3_kosong and the normal path) share it — similarity is a property of
        # the submission, not of which modules ran. Under the default
        # TIER_VERDICT_SOURCE='llm' it never drives the matrix.
        if settings.SHADOW_RULE_VERDICT:
            try:
                sim_t1, sim_t3 = answer_similarity(
                    ctx.tier1_answer, ctx.tier3_reason,
                    ctx.reference_t1_vec, ctx.reference_t3_vec,
                )
            except EmbeddingError as e:  # noqa: BLE001 — embedding failure is non-fatal
                logger.warning(
                    'Answer-similarity embedding failed for %s (non-fatal): %s',
                    submission_id, e,
                )
                sim_t1 = sim_t3 = None
        else:
            sim_t1 = sim_t3 = None

        rule_t1, rule_t3 = classify_tiers(
            sim_t1, sim_t3,
            settings.ANSWER_SIM_T1_THRESHOLD,
            settings.ANSWER_SIM_T3_THRESHOLD,
        )
        verdict_shadow = {
            'rule_t1': rule_t1,
            'rule_t3': rule_t3,
            'sim_t1': sim_t1,
            'sim_t3': sim_t3,
            'threshold_t1': settings.ANSWER_SIM_T1_THRESHOLD,
            'threshold_t3': settings.ANSWER_SIM_T3_THRESHOLD,
            'source': settings.TIER_VERDICT_SOURCE,
        }

        # Citation state, filled by Modul B/C below (stays empty on the
        # zero-chunk path and the t3_kosong path).
        referensi = []
        what_should_be_learned = []
        mod_c_referensi = []

        # 1. Deterministic Heuristic Pre-Checks
        flags = compute_heuristic_flags(ctx.tier1_answer, ctx.tier3_reason)
        with connection.cursor() as cur:
            cur.execute(
                'UPDATE submissions SET heuristic_flags = %s WHERE id = %s;',
                [json.dumps(flags), submission_id]
            )

        # 2. Penanganan t3_kosong (< 5 kata / kosong)
        if 't3_kosong' in flags:
            mod_a_score, mod_a_exp = run_module_a(ctx, model_identifier)
            mod_b_score = 'SALAH'
            mod_c_code = None
            mod_c_label = None
            mod_c_conf = 0.0
            mod_c_exp = ''
            category = 'LK'
            meaning = 'Tidak paham konsep / alasan kosong'
            risk = 'SEDANG_RENDAH'

            # C3: the LLM verdict is always recorded, independent of source.
            llm_t1_score = mod_a_score
            llm_t3_score = mod_b_score
            mod_a_score, mod_b_score = _driving_verdicts(
                llm_t1_score, llm_t3_score, rule_t1, rule_t3)

        else:
            if 't1_berisi_alasan' in flags or 't3_redundan' in flags:
                combined_reason = f"Jawaban: {ctx.tier1_answer}\nAlasan: {ctx.tier3_reason}"
                eval_b_ctx = dataclasses.replace(ctx, tier3_reason=combined_reason)
            else:
                eval_b_ctx = ctx

            mod_a_score, mod_a_exp = run_module_a(ctx, model_identifier)
            mod_b_score, referensi, what_should_be_learned = run_module_b(eval_b_ctx, model_identifier)

            # Safeguard C: Validasi di Python
            t3_words = [w for w in ctx.tier3_reason.strip().split() if w]
            has_math_derivation = bool(re.search(r'[=+\-*/]', ctx.tier3_reason))

            if mod_b_score == 'BENAR' and len(t3_words) <= 3 and not has_math_derivation:
                mod_b_score = 'SALAH'

            # C3: the LLM verdict is always recorded, before source selection
            # (Safeguard C above already applies to the LLM verdict).
            llm_t1_score = mod_a_score
            llm_t3_score = mod_b_score

            # Modul C: Ambil code dan label_name
            mod_c_code = None
            mod_c_label = None
            mod_c_exp = ''
            mod_c_conf = 0.0
            mod_c_referensi = []
            if mod_b_score == 'SALAH' or 't1_berisi_alasan' in flags:
                mod_c_code, mod_c_label, mod_c_conf, mod_c_exp, mod_c_referensi = run_module_c(ctx, model_identifier)

            # Source selection (D11): 'llm' drives by default; 'rule' would use
            # the shadow verdict, falling back to the LLM where unmeasured.
            mod_a_score, mod_b_score = _driving_verdicts(
                llm_t1_score, llm_t3_score, rule_t1, rule_t3)

            # Matriks Keputusan
            category, meaning, risk = evaluate_decision_matrix(
                mod_a_score, ctx.tier2_confidence,
                mod_b_score, ctx.tier4_confidence
            )

        # 2b. Citation validation + grounding (valid citations only)
        retrieved_by_id = {c['chunk_id']: c for c in ctx.reference_chunks}
        seen_citation_ids = set()
        combined_referensi = []
        for ref in (referensi + mod_c_referensi):
            cid = ref.get('chunk_id')
            if cid in seen_citation_ids:
                continue
            seen_citation_ids.add(cid)
            combined_referensi.append(ref)
        references = validate_citations(combined_referensi, retrieved_by_id)

        # 3. Perhitungan Skor Biner All-or-Nothing (Target 3 & Target 4)
        if mod_a_score == 'BENAR' and mod_b_score == 'BENAR':
            percentage_correct = Decimal('100.00')
        else:
            percentage_correct = Decimal('0.00')

        total_ms = int((time.monotonic() - started) * 1000)

        # 4. Penyelarasan Label Miskonsepsi
        if category == 'SC':
            mod_c_code = None
            mod_c_label = None
            misc_role = None
            misc_role_label = None
        elif mod_c_code and mod_c_code != 'MK-LAIN':
            is_confirmed_type = category in ('FP', 'MSC')
            misc_role = 'CONFIRMED_MISCONCEPTION' if is_confirmed_type else 'CLASS_MAPPING_INDICATION'
            misc_role_label = 'Miskonsepsi yang Diyakini' if is_confirmed_type else 'Indikasi untuk Pemetaan Kelas'
        elif mod_c_code == 'MK-LAIN':
            misc_role = 'CLASS_MAPPING_INDICATION'
            misc_role_label = 'Catatan Penalaran Tambahan'
        else:
            misc_role = None
            misc_role_label = None

        # 5. Sintesis Penjelasan Klinis untuk Dosen
        intervention_text = INTERVENTIONS.get(
            category,
            "Dosen disarankan meninjau kembali pemahaman konsep mahasiswa secara berkala."
        )

        explanation_lines = [
            f"Kategori: [{category}] {meaning}.",
            f"Jawaban (Tier 1): {mod_a_score} ({mod_a_exp}).",
            f"Alasan (Tier 3): {mod_b_score}.",
        ]
        if mod_c_code and misc_role_label:
            display_text = mod_c_label if mod_c_label else mod_c_code
            explanation_lines.append(f"{misc_role_label}: {display_text} ({mod_c_exp}).")

        explanation_lines.append(f"Rekomendasi Intervensi Dosen: {intervention_text}")
        explanation = "\n".join(explanation_lines)

        concept_breakdown = {
            'module_a': {'score': mod_a_score, 'reasoning': mod_a_exp},
            'module_b': {'score': mod_b_score},
            'module_c': {
                'code': mod_c_code,
                'label': mod_c_label,
                'confidence': mod_c_conf,
                'reasoning': mod_c_exp,
                'role': misc_role,
                'role_label': misc_role_label,
            } if mod_c_code else None,
            'decision_matrix': {
                't1': mod_a_score, 't2_yakin': ctx.tier2_confidence >= 4,
                't3': mod_b_score, 't4_yakin': ctx.tier4_confidence >= 4,
                'category': category, 'meaning': meaning, 'risk': risk,
            },
            'heuristic_flags': flags,
            'percentage_correct': float(percentage_correct),
            'intervention': intervention_text,
            'references': references,
            'what_should_be_learned': what_should_be_learned,
        }

        # 6. Simpan Hasil Analisis via Stored Procedure
        tier_level = CATEGORY_TO_LEVEL.get(category, 1)

        with connection.cursor() as cur:
            cur.execute(
                """
                CALL sp_record_llm_analysis(
                    %s::uuid, %s::varchar, %s::varchar, %s::numeric, %s::integer,
                    %s::jsonb, %s::jsonb, %s::text, %s::numeric, %s::jsonb, %s::integer,
                    %s::varchar, %s::varchar, %s::varchar, %s::varchar, %s::varchar,
                    NULL,
                    %s::numeric, %s::numeric, %s::integer, %s::jsonb,
                    %s::numeric, %s::numeric, %s::varchar, %s::varchar, %s::jsonb
                );
                """,
                [
                    submission_id,
                    model_identifier[:100],
                    PROMPT_VERSION,
                    percentage_correct,
                    tier_level,
                    json.dumps(concept_breakdown, ensure_ascii=False),
                    json.dumps(what_should_be_learned, ensure_ascii=False),
                    explanation,
                    Decimal('0.900'),
                    json.dumps({'concept_breakdown': concept_breakdown}),
                    total_ms,
                    mod_a_score,
                    mod_b_score,
                    mod_c_code,
                    category,
                    risk,
                    # C8/D17: the grounding metric and its input left together.
                    # The columns stay (history), but no new row produces them.
                    None,
                    None,
                    None,
                    json.dumps({}, ensure_ascii=False),
                    sim_t1,
                    sim_t3,
                    llm_t1_score,
                    llm_t3_score,
                    json.dumps(verdict_shadow, ensure_ascii=False),
                ],
            )

        logger.info(
            'Four-Tier Submission %s dianalisis -> [%s] %s (Skor: %s%%) dalam %dms',
            submission_id, category, meaning, percentage_correct, total_ms
        )

        # C4: enqueue reading material for every non-SC category. This is a cheap
        # INSERT ... ON CONFLICT DO NOTHING and makes NO LLM call — generation is
        # asynchronous (the 10-minute zombie window means it must not run here).
        # A queue failure is non-fatal: it must never fail an analysis.
        if category != 'SC' and getattr(ctx, 'question_version_id', None):
            try:
                from api.reading_materials import enqueue_reading_material
                enqueue_reading_material(ctx.question_version_id, category)
            except Exception as e:  # noqa: BLE001 — queueing must never fail an analysis
                logger.warning(
                    'Reading-material enqueue failed for %s (non-fatal): %s',
                    submission_id, e,
                )
        return 'PENDING_VALIDATION'

    except Exception as e:
        logger.error('Analisis Four-Tier gagal untuk %s: %s', submission_id, e)
        try:
            with connection.cursor() as cur:
                cur.execute(
                    'CALL sp_mark_submission_failed(%s, %s);',
                    [submission_id, str(e)[:2000]],
                )
        except Exception as mark_err:
            logger.error('Gagal menandai submission %s failed: %s', submission_id, mark_err)
        return 'ANALYSIS_FAILED'
