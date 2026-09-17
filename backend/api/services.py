import json
import re
from openai import OpenAI
from django.conf import settings

def get_llm_client():
    return OpenAI(
        base_url=getattr(settings, 'LLM_BASE_URL', 'http://127.0.0.1:8080/v1'),
        api_key=getattr(settings, 'LLM_API_KEY', 'local-llama-cpp')
    )

def extract_thinking_and_json(raw_text: str):
    """Separates the <think>...</think> reasoning chain from the JSON payload."""
    thinking_process = ""
    json_payload = {}

    think_match = re.search(r'<think>(.*?)</think>', raw_text, re.DOTALL)
    if think_match:
        thinking_process = think_match.group(1).strip()
        cleaned_text = re.sub(r'<think>.*?</think>', '', raw_text, flags=re.DOTALL).strip()
    else:
        cleaned_text = raw_text.strip()

    cleaned_text = re.sub(r'^```(?:json)?', '', cleaned_text, flags=re.MULTILINE)
    cleaned_text = re.sub(r'```$', '', cleaned_text, flags=re.MULTILINE).strip()

    json_match = re.search(r'\{.*\}', cleaned_text, re.DOTALL)
    if json_match:
        try:
            json_payload = json.loads(json_match.group(0))
        except json.JSONDecodeError:
            json_payload = {"raw_output": cleaned_text}
    else:
        json_payload = {"raw_output": cleaned_text}

    return thinking_process, json_payload

def analyze_student_concept(question: str, answer: str, reasoning: str, reference_concept: str = ""):
    """
    UC-03: Performs AI Clinical Analysis on particle dynamics response.
    """
    client = get_llm_client()
    model = getattr(settings, 'LLM_MODEL', 'Ling-3.0-tiny')

    system_prompt = (
        "Anda adalah pakar fisika dan asisten diagnosis miskonsepsi klinis untuk materi dinamika partikel (Hukum Newton).\n"
        "Tugas Anda: Analisis jawaban dan alasan mahasiswa secara mendalam.\n"
        "Klasifikasikan status mahasiswa ke dalam salah satu dari 3 kategori:\n"
        "1. 'paham' (konsep dan penalaran benar)\n"
        "2. 'tidak paham' (tidak menjawab atau tidak tahu konsep)\n"
        "3. 'miskonsepsi' (yakin dengan jawaban namun menggunakan konsep fisika yang keliru, misal: inersia dianggap sebagai gaya aktif)\n\n"
        "Setelah proses berpikir Anda, WAJIB kembalikan format JSON valid dengan struktur:\n"
        "{\n"
        '  "status": "paham" | "tidak_paham" | "miskonsepsi",\n'
        '  "nama_miskonsepsi": "nama pola miskonsepsi jika ada (atau null jika paham)",\n'
        '  "analisis": "penjelasan analisis klinis penalaran mahasiswa",\n'
        '  "konsep_sebenarnya": "penjelasan konsep fisika yang benar",\n'
        '  "confidence": 0.95\n'
        "}"
    )

    user_prompt = (
        f"Pertanyaan Konseptual:\n{question}\n\n"
        f"Konsep Acuan/Kunci:\n{reference_concept if reference_concept else 'Hukum Newton tentang Gerak'}\n\n"
        f"Jawaban Mahasiswa:\n{answer}\n\n"
        f"Alasan Mahasiswa:\n{reasoning}\n"
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.2,
    )

    raw_response = response.choices[0].message.content or ""
    thinking_process, json_result = extract_thinking_and_json(raw_response)

    return {
        "thinking_process": thinking_process,
        "result": json_result
    }
