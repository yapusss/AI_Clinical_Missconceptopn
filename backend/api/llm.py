"""Four-Tier AI Diagnostic Pipeline (v2.6 - Calibrated).

1. Heuristic Pre-Check (Rules Engine, Non-AI, PDF Hal. 4):
   - t1_berisi_alasan: Tier 1 memuat kata sebab ('karena', 'sebab', dll.)
   - t3_kosong: Tier 3 kosong atau < 5 kata
   - t3_redundan: Tier 3 hanya menyalin ulang isi Tier 1 tanpa penurunan baru
   - t3_hafalan: Tier 3 hanya mengutip nama/bunyi hukum tanpa penerapan variabel/matematika

2. Modular AI Grading:
   - Module A: Menilai kesimpulan Tier 1 (maks 120 karakter) -> BENAR / BENAR_SEBAGIAN / SALAH
   - Module B: Menilai alasan Tier 3 (termasuk penurunan aljabar/matematis) -> BENAR / SALAH
   - Module C: Menilai miskonsepsi dari katalog jika Modul B bernilai SALAH

3. Deterministic Decision Matrix (16 Rules, PDF Hal. 3):
   - Memetakan kombinasi (T1, T2, T3, T4) ke kategori SC, LK, FP, FN, MSC.

4. Deterministic Percentage Scoring (Option A):
   - Tier 1: Maksimal 30.00%
    - Tier 3: 70.00% bila BENAR, 0.00% bila SALAH
"""

import dataclasses
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

PROMPT_VERSION = 'four-tier-v2.6'
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

    # Rule 1: Tier 1 memuat kata sebab
    if CAUSAL_WORDS_REGEX.search(t1):
        flags.append('t1_berisi_alasan')

    # Rule 2: Tier 3 kosong atau kurang dari 5 kata
    if len(words_t3) < 5:
        flags.append('t3_kosong')

    # Rule 3: Tier 3 redundan dengan Tier 1
    # Hanya ditandai jika Tier 3 hampir 100% sama dengan Tier 1 (bukan sekadar hasil hitungan akhir yang cocok)
    clean_t1 = re.sub(r'[^\w\s]', '', t1).lower().strip()
    clean_t3 = re.sub(r'[^\w\s]', '', t3).lower().strip()
    if clean_t1 and clean_t3:
        if clean_t1 == clean_t3 or (clean_t1 in clean_t3 and len(clean_t3) <= len(clean_t1) + 6):
            flags.append('t3_redundan')

    # Rule 4: Tier 3 hanya kutipan hukum hafalan tanpa penerapan
    # Hanya ditandai jika mahasiswa mengutip nama hukum TANPA ada operasi matematika/variabel soal
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
    model_answer: str
    set_title: str
    misconceptions: list      # [{id, label, description}]
    rejection_notes: str
    prior_explanation: str


def load_context(submission_id: str) -> FourTierContext:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.subject_id, s.status,
                   COALESCE(s.tier1_answer, ''), COALESCE(s.tier2_confidence, 1),
                   COALESCE(s.tier3_reason, s.answer_text), COALESCE(s.tier4_confidence, 1),
                   COALESCE(s.heuristic_flags, '[]'::jsonb),
                   qv.prompt, qv.model_answer, qs.title
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
        set_title=row[10],
        misconceptions=misconceptions,
        rejection_notes=(prior[0] or '')[:2000],
        prior_explanation=(prior[1] or '')[:2000],
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


def _call_llm_json(system_prompt: str, user_prompt: str) -> dict:
    client = get_llm_client()
    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_prompt},
    ]
    last_error = None
    for attempt in range(LLM_MAX_RETRIES + 1):
        try:
            kwargs = {
                'model': settings.LLM_MODEL,
                'messages': messages,
                'temperature': LLM_TEMPERATURE,
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
# 4. Modular AI Evaluation Modules (Modul A, Modul B, Modul C)
# ----------------------------------------------------------------------------

def run_module_a(ctx: FourTierContext) -> tuple[str, str]:
    """Modul A — Penilai Jawaban Singkat (Tier 1)."""
    sys_prompt = (
        "Anda adalah Modul A: Penilai Jawaban (Tier 1) untuk asesmen diagnostik Four-Tier.\n"
        "Tugas: Nilai ketepatan kesimpulan esai singkat mahasiswa (maks 120 karakter).\n"
        "Kembalikan HANYA format JSON valid:\n"
        "{\n"
        '  "score": "BENAR" | "BENAR_SEBAGIAN" | "SALAH",\n'
        '  "reasoning": "penjelasan singkat 1 kalimat dalam Bahasa Indonesia"\n'
        "}"
    )
    user_prompt = (
        f"Pertanyaan:\n{ctx.question_prompt}\n\n"
        f"Jawaban Model (Acuan Kebenaran):\n{ctx.model_answer}\n\n"
        f"Jawaban Singkat Mahasiswa (Tier 1):\n{ctx.tier1_answer}"
    )
    if ctx.rejection_notes:
        user_prompt += f"\n\n[CATATAN DOSEN PADA ANALISIS SEBELUMNYA]:\n{ctx.rejection_notes}"

    data = _call_llm_json(sys_prompt, user_prompt)
    score = str(data.get('score', '')).upper()
    if score not in ('BENAR', 'BENAR_SEBAGIAN', 'SALAH'):
        score = 'SALAH'
    return score, str(data.get('reasoning', ''))


def run_module_b(ctx: FourTierContext) -> tuple[str, str]:
    """Modul B — Penilai Alasan (Tier 3) dengan Pengakuan Penurunan Matematis."""
    sys_prompt = (
        "Anda adalah Modul B: Penilai Alasan & Penalaran (Tier 3) untuk asesmen Four-Tier bidang Fisika.\n"
        "Tugas: Nilai apakah penjelasan/alasan mahasiswa secara ilmiah BENAR atau SALAH berdasarkan pertanyaan dan jawaban model.\n\n"
        "PANDUAN EVALUASI ILMIAH & MATEMATIS (WAJIB DIPATUHI):\n"
        "1. PENALARAN ALJABAR/MATEMATIS: Mahasiswa DIPERBOLEHKAN menyajikan alasan dalam bentuk penurunan rumus matematis/aljabar langkah-demi-langkah "
        "(misalnya: substitusi langsung percepatan sistem a = F/2m ke dalam persamaan tegangan tali T = m(F/2m) = F/2). "
        "Jika langkah penalaran matematis tersebut secara prinsip fisis BENAR, nilai BENAR.\n"
        "2. TIDAK WAJIB MENULIS ULANG NARASI: Jangan menyalahkan mahasiswa hanya karena menuliskan penurunan rumus ringkas tanpa kalimat narasi panjang, "
        "selama alur penurunan fisisnya valid dan dapat dipertanggungjawabkan.\n"
        "3. HUBUNGAN DENGAN TIER 1: Mahasiswa tidak wajib mengulang kata atau angka yang sudah ditulis di Tier 1 jika penurunan rumus di Tier 3 "
        "sudah secara langsung membuktikan kesimpulan tersebut.\n"
        "4. ANTI-HALUSINASI: Nilai HANYA apa yang tertulis. Jangan mengarang langkah yang tidak ada di teks mahasiswa.\n"
        "5. Seluruh field 'reasoning' WAJIB menggunakan Bahasa Indonesia formal.\n\n"
        "Kembalikan HANYA format JSON valid:\n"
        "{\n"
        '  "score": "BENAR" | "SALAH",\n'
        '  "reasoning": "penjelasan evaluasi penalaran mahasiswa dalam Bahasa Indonesia"\n'
        "}"
    )
    user_prompt = (
        f"Pertanyaan:\n{ctx.question_prompt}\n\n"
        f"Jawaban Model (Acuan Kebenaran Fisika):\n{ctx.model_answer}\n\n"
        f"Kesimpulan Mahasiswa di Tier 1:\n\"{ctx.tier1_answer}\"\n\n"
        f"Alasan/Penalaran Mahasiswa di Tier 3:\n\"{ctx.tier3_reason}\""
    )
    if ctx.rejection_notes:
        user_prompt += f"\n\n[CATATAN DOSEN PADA ANALISIS SEBELUMNYA]:\n{ctx.rejection_notes}"

    data = _call_llm_json(sys_prompt, user_prompt)
    score = str(data.get('score', '')).upper()
    if score not in ('BENAR', 'SALAH'):
        score = 'SALAH'
    return score, str(data.get('reasoning', ''))


def run_module_c(ctx: FourTierContext) -> tuple[str, str, float, str]:
    """Modul C — Klasifikasi Miskonsepsi dari Katalog.
    
    Mengembalikan: (code, label_name, confidence, reasoning)
    """
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
        "Tugas: Baca teks gabungan Tier 1 (jawaban) dan Tier 3 (alasan). Miskonsepsi adalah milik mahasiswa, "
        "bukan milik kolom — temukan pola keliru di mana pun mahasiswa menuliskannya.\n"
        f"Daftar Tipe Miskonsepsi Terdaftar:\n{misc_catalog}\n"
        "Bila tidak ada yang cocok dari katalog atau mahasiswa sebenarnya menurunkan rumus dengan benar, gunakan kode 'MK-LAIN'.\n\n"
        "ATURAN BAHASA & KETELITIAN KETAT:\n"
        "1. DILARANG KERAS mengarang miskonsepsi palsu jika penurunan aljabar mahasiswa benar.\n"
        "2. Seluruh isi field 'reasoning' WAJIB ditulis murni dalam Bahasa Indonesia formal.\n"
        "3. Field 'misconception_name' WAJIB diisi Nama Label Miskonsepsi dari daftar (BUKAN berupa deretan angka/huruf UUID ID), atau 'MK-LAIN'.\n\n"
        "Kembalikan HANYA format JSON valid:\n"
        "{\n"
        '  "misconception_code": "<id_atau_MK-LAIN>",\n'
        '  "misconception_name": "<nama_lengkap_label_miskonsepsi_atau_MK-LAIN>",\n'
        '  "confidence": 0.85,\n'
        '  "reasoning": "penjelasan evaluasi dalam Bahasa Indonesia"\n'
        "}"
    )
    user_prompt = (
        f"Pertanyaan:\n{ctx.question_prompt}\n\n"
        f"Teks Gabungan Mahasiswa:\n"
        f"Jawaban (Tier 1): {ctx.tier1_answer}\n"
        f"Alasan (Tier 3): {ctx.tier3_reason}"
    )
    data = _call_llm_json(sys_prompt, user_prompt)
    code = str(data.get('misconception_code') or 'MK-LAIN').strip()
    
    # Terjemahkan UUID menjadi Nama Label yang mudah dibaca
    raw_name = str(data.get('misconception_name') or '').strip()
    if raw_name and raw_name != code and not re.match(r'^[0-9a-f\-]{30,}$', raw_name, re.I):
        label_name = raw_name
    else:
        label_name = misc_label_map.get(code, code)
        
    try:
        conf = float(data.get('confidence', 0.8))
    except Exception:
        conf = 0.8
        
    return code, label_name, conf, str(data.get('reasoning', ''))


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

        # 1. Deterministic Heuristic Pre-Checks
        flags = compute_heuristic_flags(ctx.tier1_answer, ctx.tier3_reason)
        # Update TANPA 'if flags' agar bendera lama otomatis dibersihkan jika flags sekarang kosong []
        with connection.cursor() as cur:
            cur.execute(
                'UPDATE submissions SET heuristic_flags = %s WHERE id = %s;',
                [json.dumps(flags), submission_id]
            )

        # 2. Penanganan t3_kosong (< 5 kata / kosong)
        if 't3_kosong' in flags:
            mod_a_score, mod_a_exp = run_module_a(ctx)
            mod_b_score = 'SALAH'
            mod_b_exp = 'Alasan tidak diisi atau kurang dari 5 kata (t3_kosong). Diarahkan ke LK untuk penguatan materi dasar.'
            mod_c_code = None
            mod_c_label = None
            mod_c_conf = 0.0
            mod_c_exp = ''
            category = 'LK'
            meaning = 'Tidak paham konsep / alasan kosong'
            risk = 'SEDANG_RENDAH'

        else:
            if 't1_berisi_alasan' in flags or 't3_redundan' in flags:
                combined_reason = f"Jawaban: {ctx.tier1_answer}\nAlasan: {ctx.tier3_reason}"
                eval_b_ctx = dataclasses.replace(ctx, tier3_reason=combined_reason)
            else:
                eval_b_ctx = ctx

            mod_a_score, mod_a_exp = run_module_a(ctx)
            mod_b_score, mod_b_exp = run_module_b(eval_b_ctx)

            # Safeguard C: Validasi di Python
            t3_words = [w for w in ctx.tier3_reason.strip().split() if w]
            has_math_derivation = bool(re.search(r'[=+\-*/]', ctx.tier3_reason))

            if mod_b_score == 'BENAR' and len(t3_words) <= 3 and not has_math_derivation:
                mod_b_score = 'SALAH'
                mod_b_exp = 'Teks alasan terlalu singkat untuk memuat penurunan konsep ilmiah yang valid.'

            # Modul C: Ambil code dan label_name
            mod_c_code = None
            mod_c_label = None
            mod_c_exp = ''
            mod_c_conf = 0.0
            if mod_b_score == 'SALAH' or 't1_berisi_alasan' in flags:
                mod_c_code, mod_c_label, mod_c_conf, mod_c_exp = run_module_c(ctx)

            # Matriks Keputusan
            category, meaning, risk = evaluate_decision_matrix(
                mod_a_score, ctx.tier2_confidence,
                mod_b_score, ctx.tier4_confidence
            )

        # 3. Perhitungan Skor 30/70
        score_a = Decimal('30.00') if mod_a_score == 'BENAR' else (
            Decimal('15.00') if mod_a_score == 'BENAR_SEBAGIAN' else Decimal('0.00')
        )

        score_b = Decimal('70.00') if mod_b_score == 'BENAR' else Decimal('0.00')
        percentage_correct = min(Decimal('100.00'), max(Decimal('0.00'), score_a + score_b))

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

        # 5. Sintesis Penjelasan Klinis (Gunakan mod_c_label, BUKAN UUID)
        intervention_text = INTERVENTIONS.get(
            category,
            "Dosen disarankan meninjau kembali pemahaman konsep mahasiswa secara berkala."
        )

        explanation_lines = [
            f"Kategori: [{category}] {meaning}.",
            f"Jawaban (Tier 1): {mod_a_score} ({mod_a_exp}).",
            f"Alasan (Tier 3): {mod_b_score} ({mod_b_exp}).",
        ]
        if mod_c_code and misc_role_label:
            # Menggunakan mod_c_label (Nama Miskonsepsi) agar tidak muncul UUID lagi
            display_text = mod_c_label if mod_c_label else mod_c_code
            explanation_lines.append(f"{misc_role_label}: {display_text} ({mod_c_exp}).")

        explanation_lines.append(f"Rekomendasi Intervensi Dosen: {intervention_text}")
        explanation = "\n".join(explanation_lines)

        concept_breakdown = {
            'module_a': {'score': mod_a_score, 'reasoning': mod_a_exp, 'earned_points': float(score_a)},
            'module_b': {'score': mod_b_score, 'reasoning': mod_b_exp, 'earned_points': float(score_b)},
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
        }

        # 6. Simpan Hasil Analisis via Stored Procedure
        tier_level = CATEGORY_TO_LEVEL.get(category, 1)

        with connection.cursor() as cur:
            cur.execute(
                """
                CALL sp_record_llm_analysis(
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, NULL
                );
                """,
                [
                    submission_id,
                    settings.LLM_MODEL[:100],
                    PROMPT_VERSION,
                    percentage_correct,
                    tier_level,  # <-- Menggunakan tier_level yang selaras (bukan 1)
                    json.dumps(concept_breakdown, ensure_ascii=False),
                    json.dumps([]),
                    explanation,
                    Decimal('0.900'),
                    json.dumps({'concept_breakdown': concept_breakdown}),
                    total_ms,
                    mod_a_score,
                    mod_b_score,
                    mod_c_code,
                    category,
                    risk,
                ],
            )

        logger.info(
            'Four-Tier Submission %s dianalisis -> [%s] %s (Skor: %s%%) dalam %dms',
            submission_id, category, meaning, percentage_correct, total_ms
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
