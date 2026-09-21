"""LLM analysis pipeline (P4) — rubric-only grading.

Design (locked decisions 2026-09-20):
- Rubric-only: model answer + concept indicators + attached misconceptions.
  No RAG (knowledge_chunks is empty; ingestion is P1, deferred).
- Deterministic math: percentage_correct is computed HERE from per-indicator
  scores (PRESENT=1.0, PARTIAL=0.5, MISSING=0.0, weighted). The LLM never
  supplies the final percentage — its number is ignored.
- Advisory misconception matches: the LLM proposes matches against attached
  misconceptions; the lecturer confirms/denies each in P5 validation. A match
  never forces a tier.
- Provider-agnostic: any OpenAI-compatible endpoint (dev: local Ollama;
  production: stakeholder-supplied external API). Configured via
  LLM_BASE_URL / LLM_API_KEY / LLM_MODEL env (see settings).

State contract (all lifecycle writes go through stored procedures):
  SUBMITTED|REJECTED|ANALYSIS_FAILED --sp_mark_submission_analyzing--> ANALYZING
  ANALYZING --sp_record_llm_analysis--> PENDING_VALIDATION
  ANALYZING --sp_mark_submission_failed--> ANALYSIS_FAILED

`suggested_materials_json` is always [] until the KB exists (NOT NULL column;
the LLM is not asked for materials it cannot ground — no hallucinated refs).
"""

import json
import logging
import re
import time
from dataclasses import dataclass
from decimal import Decimal

from django.conf import settings
from django.db import connection
from openai import OpenAI

logger = logging.getLogger(__name__)

PROMPT_VERSION = 'rubric-v1'
INDICATOR_SCORES = {'PRESENT': Decimal('1.0'), 'PARTIAL': Decimal('0.5'), 'MISSING': Decimal('0.0')}
MAX_ANALYSIS_RUNS = int(getattr(settings, 'LLM_MAX_RUNS', 3))
LLM_TEMPERATURE = 0.1
LLM_MAX_RETRIES = 2  # retries within one analysis attempt (parse/API errors)


class LlmAnalysisError(Exception):
    """Raised when the LLM output cannot be turned into a valid analysis.

    The worker maps this to ANALYSIS_FAILED (retryable), never to a recorded
    analysis — garbage must not reach llm_analyses.
    """


def get_llm_client() -> OpenAI:
    return OpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.LLM_API_KEY,
        timeout=getattr(settings, 'LLM_TIMEOUT', 120.0),
    )


# ----------------------------------------------------------------------------
# Context loading (single round-trip per submission)
# ----------------------------------------------------------------------------

@dataclass
class AnalysisContext:
    submission_id: str
    subject_id: str
    status: str
    answer_text: str
    attempt_no: int
    run_count: int
    question_prompt: str
    model_answer: str
    set_title: str
    indicators: list          # [{label, description, weight(Decimal), order_index}]
    misconceptions: list      # [{id, label, description}]
    tiers: list               # [{level, label, description}] resolved for subject
    rejection_notes: str      # latest validation notes when re-running a REJECTED
    prior_explanation: str    # prior (rejected/failed) analysis explanation


def load_context(submission_id: str) -> AnalysisContext:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.subject_id, s.status, s.answer_text, s.attempt_no,
                   qv.prompt, qv.model_answer, qs.title,
                   (SELECT count(*) FROM llm_analyses la WHERE la.submission_id = s.id)
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
            SELECT label, coalesce(description, ''), weight, order_index
            FROM concept_indicators
            WHERE question_version_id = (
                SELECT question_version_id FROM submissions WHERE id = %s)
            ORDER BY order_index
            """,
            [submission_id],
        )
        indicators = [
            {'label': r[0], 'description': r[1], 'weight': r[2], 'order_index': r[3]}
            for r in cur.fetchall()
        ]
        if not indicators:
            raise LlmAnalysisError(
                f'Submission {submission_id}: question version has no concept indicators '
                '(rubric grading impossible)'
            )

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
            {'id': str(r[0]), 'label': r[1], 'description': r[2]} for r in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT dt.level, dt.label, coalesce(dt.description, '')
            FROM diagnostic_tiers dt
            WHERE dt.is_active
              AND (dt.subject_id = (SELECT subject_id FROM submissions WHERE id = %s)
                   OR dt.subject_id IS NULL)
            ORDER BY dt.subject_id NULLS LAST, dt.level
            """,
            [submission_id],
        )
        seen_levels = set()
        tiers = []
        for level, label, description in cur.fetchall():
            if level in seen_levels:  # subject-specific wins over universal
                continue
            seen_levels.add(level)
            tiers.append({'level': level, 'label': label, 'description': description})
        if not tiers:
            raise LlmAnalysisError(
                f'Submission {submission_id}: no diagnostic tiers resolvable for subject'
            )

        # Re-run context: latest rejection notes + prior explanation (bounded).
        cur.execute(
            """
            SELECT coalesce(v.notes, ''), coalesce(a.explanation, '')
            FROM llm_analyses a
            LEFT JOIN validations v ON v.analysis_id = a.id
            WHERE a.submission_id = %s
            ORDER BY a.run_number DESC
            LIMIT 1
            """,
            [submission_id],
        )
        prior = cur.fetchone() or ('', '')

    return AnalysisContext(
        submission_id=str(row[0]),
        subject_id=str(row[1]),
        status=row[2],
        answer_text=row[3],
        attempt_no=row[4],
        run_count=row[8],
        question_prompt=row[5],
        model_answer=row[6],
        set_title=row[7],
        indicators=indicators,
        misconceptions=misconceptions,
        tiers=tiers,
        rejection_notes=(prior[0] or '')[:2000],
        prior_explanation=(prior[1] or '')[:2000],
    )


# ----------------------------------------------------------------------------
# Prompt construction
# ----------------------------------------------------------------------------

def build_messages(ctx: AnalysisContext) -> list[dict]:
    indicator_lines = '\n'.join(
        f"{i + 1}. {ind['label']} (bobot {ind['weight']})"
        + (f" — {ind['description']}" if ind['description'] else '')
        for i, ind in enumerate(ctx.indicators)
    )
    tier_lines = '\n'.join(
        f"Level {t['level']} = {t['label']}: {t['description']}" for t in ctx.tiers
    )
    tier_levels = [t['level'] for t in ctx.tiers]

    if ctx.misconceptions:
        misconception_lines = '\n'.join(
            f"- id={m['id']} | {m['label']}: {m['description']}" for m in ctx.misconceptions
        )
        misconception_block = (
            'Daftar miskonsepsi yang dikenal untuk soal ini (sifatnya ADVISORY — '
            'usulan Anda akan dikonfirmasi/ditolak oleh dosen, dan TIDAK boleh memaksa tier):\n'
            f'{misconception_lines}\n'
            'Untuk tiap miskonsepsi di atas, nilai apakah jawaban mahasiswa cocok '
            '(matched true/false) beserta alasannya.\n'
        )
        matched_schema = (
            '"misconception_matches": [{"misconception_id": "<id dari daftar>", '
            '"matched": true|false, "confidence": 0.0, "reasoning": "..."}], '
            '"proposed_new_misconception": "label singkat bila ada pola keliru di luar daftar, else null"'
        )
    else:
        misconception_block = (
            'Tidak ada daftar miskonsepsi untuk soal ini. Kosongkan '
            '"misconception_matches" ([]) dan isi "proposed_new_misconception" hanya '
            'bila jawaban menunjukkan pola miskonsepsi yang jelas.\n'
        )
        matched_schema = (
            '"misconception_matches": [], '
            '"proposed_new_misconception": "label singkat bila ada pola keliru yang jelas, else null"'
        )

    rerun_block = ''
    if ctx.status == 'REJECTED' and (ctx.rejection_notes or ctx.prior_explanation):
        rerun_block = (
            '\nCATATAN PENTING — ANALISIS ULANG:\n'
            'Analisis sebelumnya untuk jawaban ini DITOLAK oleh dosen.\n'
            f'Catatan dosen: {ctx.rejection_notes or "(tidak ada catatan)"}\n'
            f'Analisis sebelumnya: {ctx.prior_explanation or "(tidak tersedia)"}\n'
            'Perhatikan catatan dosen tersebut dan hasilkan analisis yang lebih baik.\n'
        )

    system_prompt = (
        'Anda adalah pakar diagnosis miskonsepsi konseptual untuk platform evaluasi akademik.\n'
        'Tugas: menilai jawaban esai mahasiswa terhadap satu pertanyaan konseptual, '
        'berdasarkan RUBRIK indikator yang diberikan.\n\n'
        'ATURAN PENILAIAN:\n'
        f'1. Untuk SETIAP indikator rubrik, beri skor: "PRESENT" (terpenuhi penuh), '
        f'"PARTIAL" (sebagian), atau "MISSING" (tidak terpenuhi), beserta bukti singkat '
        f'kutipan/parafrase dari jawaban.\n'
        '2. JANGAN menghitung persentase akhir — sistem yang menghitung dari skor indikator Anda.\n'
        f'3. Pilih tier diagnosis HANYA dari level yang tersedia: {tier_levels}.\n'
        f'Definisi tier:\n{tier_lines}\n'
        '4. "explanation": analisis klinis singkat (2-4 kalimat) dalam Bahasa Indonesia: '
        'apa yang dipahami, apa yang keliru/kurang, dan saran perbaikan konseptual.\n'
        '5. "confidence": keyakinan Anda 0.0-1.0 terhadap diagnosis ini.\n'
        '6. Jawaban kosong/irrelevan -> semua indikator MISSING dan tier terendah.\n\n'
        f'{misconception_block}\n'
        'Kembalikan HANYA satu objek JSON valid, tanpa teks lain, dengan struktur:\n'
        '{\n'
        '  "indicators": [{"order_index": 1, "score": "PRESENT|PARTIAL|MISSING", "evidence": "..."}],\n'
        f'  {matched_schema},\n'
        '  "tier_level": <int, dari level yang tersedia>,\n'
        '  "explanation": "...",\n'
        '  "confidence": 0.0\n'
        '}'
    )

    user_prompt = (
        f'Pertanyaan konseptual (set: {ctx.set_title}):\n{ctx.question_prompt}\n\n'
        f'Jawaban model (acuan kebenaran):\n{ctx.model_answer}\n\n'
        f'RUBRIK indikator (bobot harus digunakan sistem, Anda hanya memberi skor per indikator):\n'
        f'{indicator_lines}\n\n'
        f'Jawaban mahasiswa:\n{ctx.answer_text}\n'
        f'{rerun_block}'
    )

    return [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_prompt},
    ]


# ----------------------------------------------------------------------------
# LLM call + strict output validation
# ----------------------------------------------------------------------------

def _extract_json(raw: str) -> dict:
    """Parse the JSON object out of a completion (tolerates code fences/prose)."""
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


def _call_llm(messages: list[dict]) -> tuple[dict, str, int]:
    """Returns (parsed_json, raw_text, execution_time_ms)."""
    client = get_llm_client()
    model = settings.LLM_MODEL
    started = time.monotonic()
    last_error = None
    for attempt in range(LLM_MAX_RETRIES + 1):
        try:
            kwargs = {
                'model': model,
                'messages': messages,
                'temperature': LLM_TEMPERATURE,
            }
            # JSON mode where supported; _extract_json handles providers without it.
            try:
                response = client.chat.completions.create(
                    response_format={'type': 'json_object'}, **kwargs
                )
            except Exception:
                response = client.chat.completions.create(**kwargs)
            raw = response.choices[0].message.content or ''
            elapsed_ms = int((time.monotonic() - started) * 1000)
            return _extract_json(raw), raw, elapsed_ms
        except LlmAnalysisError as e:
            last_error = e
            if attempt < LLM_MAX_RETRIES:
                continue
        except Exception as e:  # API/network errors
            last_error = LlmAnalysisError(f'LLM API error: {e}')
            if attempt < LLM_MAX_RETRIES:
                time.sleep(1.5 * (attempt + 1))
                continue
    raise last_error


def compute_percentage(ctx: AnalysisContext, indicator_scores: dict[int, str]) -> Decimal:
    """Deterministic weighted score: sum(weight * score_value) * 100, clamped 0-100.

    This is the ONLY source of percentage_correct — the LLM's number is never used.
    """
    total = Decimal(0)
    for ind in ctx.indicators:
        score = indicator_scores.get(ind['order_index'], 'MISSING')
        total += Decimal(ind['weight']) * INDICATOR_SCORES[score]
    pct = (total * 100).quantize(Decimal('0.01'))
    return max(Decimal('0.00'), min(Decimal('100.00'), pct))


def validate_output(ctx: AnalysisContext, payload: dict, raw: str) -> dict:
    """Strict structural validation. Any failure -> LlmAnalysisError (never persisted)."""
    valid_levels = {t['level'] for t in ctx.tiers}

    raw_indicators = payload.get('indicators')
    if not isinstance(raw_indicators, list) or not raw_indicators:
        raise LlmAnalysisError('"indicators" missing or not a non-empty list')

    indicator_scores: dict[int, str] = {}
    breakdown = []
    expected_orders = {ind['order_index'] for ind in ctx.indicators}
    for item in raw_indicators:
        if not isinstance(item, dict):
            raise LlmAnalysisError('indicator entry is not an object')
        try:
            order = int(item.get('order_index'))
        except (TypeError, ValueError):
            raise LlmAnalysisError(f'invalid indicator order_index: {item.get("order_index")!r}')
        if order not in expected_orders:
            raise LlmAnalysisError(f'indicator order_index {order} not in rubric {sorted(expected_orders)}')
        score = str(item.get('score', '')).upper()
        if score not in INDICATOR_SCORES:
            raise LlmAnalysisError(f'invalid indicator score {score!r} for order_index {order}')
        if order in indicator_scores:
            raise LlmAnalysisError(f'duplicate indicator order_index {order}')
        indicator_scores[order] = score
        breakdown.append({
            'order_index': order,
            'label': next(i['label'] for i in ctx.indicators if i['order_index'] == order),
            'weight': str(next(i['weight'] for i in ctx.indicators if i['order_index'] == order)),
            'score': score,
            'evidence': str(item.get('evidence', ''))[:500],
        })
    if set(indicator_scores) != expected_orders:
        missing = sorted(expected_orders - set(indicator_scores))
        raise LlmAnalysisError(f'indicators missing scores for order_index {missing}')
    breakdown.sort(key=lambda b: b['order_index'])

    try:
        tier_level = int(payload.get('tier_level'))
    except (TypeError, ValueError):
        raise LlmAnalysisError(f'invalid tier_level: {payload.get("tier_level")!r}')
    if tier_level not in valid_levels:
        raise LlmAnalysisError(
            f'tier_level {tier_level} not in subject tiers {sorted(valid_levels)}'
        )

    explanation = str(payload.get('explanation', '')).strip()
    if not explanation:
        raise LlmAnalysisError('"explanation" is empty')

    try:
        confidence = Decimal(str(payload.get('confidence')))
    except Exception:
        raise LlmAnalysisError(f'invalid confidence: {payload.get("confidence")!r}')
    if not (Decimal(0) <= confidence <= Decimal(1)):
        raise LlmAnalysisError(f'confidence {confidence} outside [0,1]')
    confidence = confidence.quantize(Decimal('0.001'))

    # Advisory misconception matches: keep only ids attached to this version.
    known_ids = {m['id'] for m in ctx.misconceptions}
    matches = []
    raw_matches = payload.get('misconception_matches') or []
    if isinstance(raw_matches, list):
        for m in raw_matches:
            if not isinstance(m, dict):
                continue
            mid = str(m.get('misconception_id', ''))
            if mid not in known_ids:
                continue  # hallucinated id -> drop silently (advisory data)
            try:
                m_conf = max(Decimal(0), min(Decimal(1), Decimal(str(m.get('confidence', 0)))))
            except Exception:
                m_conf = Decimal(0)
            matches.append({
                'misconception_id': mid,
                'label': next(x['label'] for x in ctx.misconceptions if x['id'] == mid),
                'matched': bool(m.get('matched')),
                'confidence': str(m_conf.quantize(Decimal('0.001'))),
                'reasoning': str(m.get('reasoning', ''))[:500],
            })

    proposed = payload.get('proposed_new_misconception')
    proposed = str(proposed).strip()[:255] if isinstance(proposed, str) and proposed.strip() else None

    percentage = compute_percentage(ctx, indicator_scores)

    concept_breakdown = {
        'indicators': breakdown,
        'percentage_correct': str(percentage),
        'misconception_matches': matches,
        'proposed_new_misconception': proposed,
    }

    return {
        'percentage_correct': percentage,
        'tier_level': tier_level,
        'concept_breakdown': concept_breakdown,
        'suggested_materials': [],  # KB empty (P1 deferred); NOT NULL column needs []
        'explanation': explanation,
        'confidence': confidence,
        'raw_output': {'llm_json': payload, 'raw_text': raw[:8000]},
    }


# ----------------------------------------------------------------------------
# Pipeline entry point — one submission, end to end
# ----------------------------------------------------------------------------

def analyze_submission(submission_id: str) -> str:
    """Run the full P4 pipeline for one submission. Returns final status.

    All state transitions go through stored procedures. On any LLM/parse
    failure the submission is marked ANALYSIS_FAILED (retryable).
    """
    started = time.monotonic()

    # 1. Claim: -> ANALYZING (proc enforces legal source states)
    with connection.cursor() as cur:
        try:
            cur.execute('CALL sp_mark_submission_analyzing(%s);', [submission_id])
        except Exception as e:
            logger.warning('Cannot claim submission %s: %s', submission_id, e)
            return 'SKIPPED'

    try:
        ctx = load_context(submission_id)
        messages = build_messages(ctx)
        payload, raw, llm_ms = _call_llm(messages)
        result = validate_output(ctx, payload, raw)
        total_ms = int((time.monotonic() - started) * 1000)

        with connection.cursor() as cur:
            cur.execute(
                'CALL sp_record_llm_analysis(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL);',
                [
                    submission_id,
                    settings.LLM_MODEL[:100],
                    PROMPT_VERSION,
                    result['percentage_correct'],
                    result['tier_level'],
                    json.dumps(result['concept_breakdown'], ensure_ascii=False),
                    json.dumps(result['suggested_materials']),
                    result['explanation'],
                    result['confidence'],
                    json.dumps(result['raw_output'], ensure_ascii=False),
                    total_ms,
                ],
            )
        logger.info(
            'Submission %s analyzed: tier=%s pct=%s (%dms, llm %dms)',
            submission_id, result['tier_level'], result['percentage_correct'], total_ms, llm_ms,
        )
        return 'PENDING_VALIDATION'
    except Exception as e:
        logger.error('Analysis failed for %s: %s', submission_id, e)
        try:
            with connection.cursor() as cur:
                cur.execute(
                    'CALL sp_mark_submission_failed(%s, %s);',
                    [submission_id, str(e)[:2000]],
                )
        except Exception as mark_err:
            logger.error('Could not mark %s failed: %s', submission_id, mark_err)
        return 'ANALYSIS_FAILED'
