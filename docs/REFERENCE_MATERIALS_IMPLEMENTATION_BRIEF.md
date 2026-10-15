# Reference Materials + Grounding Similarity — Implementation Brief

**Audience:** an autonomous coding agent (OpenCode) working in
`D:/ClinicalAI_Misconception/Code/AI_Clinical_Missconceptopn` (the git repo root; `D:/ClinicalAI_Misconception` is NOT a repo).
**Companion doc (rationale + open items):** `D:/ClinicalAI_Misconception/Context/Reference_Materials_Plan.md` (outside the repo; readable by absolute path).
**Status:** spec for implementation. No code exists yet for this feature.

---

## 0. Agent operating rules — read first

1. **Never run `makemigrations`.** `api/migrations/0001_initial.py` declares only `User`/`AuthToken`; the autodetector would propose one bogus migration creating every unmanaged model. Every schema change here is a hand-written reversible `RunSQL` migration.
2. **Never re-import `V2_Full_Script.sql`.** The deployed DB holds real data. Changes are additive migrations on top of it.
3. **Scope = this repo only.** Do not touch files outside it or another Hermes profile's files.
4. **All lifecycle DB writes go through stored procedures**, not ORM `save()`. `LlmAnalysis` and friends are `managed = False` read-models.
5. **Prove it with real HTTP** against a live DB. Static reading cannot catch the proc-signature and prompt-contract failures this feature introduces. Restart every `--noreload` service after edits or you are testing stale code.
6. **Commit in small, labelled steps** (one commit per phase). Conventional Commits style.
7. If something here contradicts the code, **the code wins** — stop and report the contradiction rather than improvising.

---

## 1. Objective & acceptance criteria

Give the LLM real reference materials so it can (a) point out student misconceptions grounded in an assigned textbook and (b) list *what the student should learn*, with citations; and measure how well the AI's advice is grounded in the passages it cited.

**Acceptance (all must be demonstrated with real output, not described):**

| # | Criterion |
|---|---|
| A1 | A lecturer-scoped PDF/MD reference ingests into `knowledge_documents`/`knowledge_chunks` with non-null 1536-dim embeddings and per-chunk page metadata. |
| A2 | `fn_search_knowledge_chunks` returns sensible passages for a topical query against the ingested doc. |
| A3 | The P4 worker injects retrieved chunks into Modul B/C and the LLM output contains a `references` array whose `chunk_id`s resolve to real retrieved chunks. |
| A4 | `llm_analyses.grounding_similarity` is non-null for an analysis that cited ≥1 valid chunk, and `grounding_payload_json` records every citation with its cosine and validity. |
| A5 | `suggested_materials_json` is populated with the "what should be learned" list (hardcoded `[]` today). |
| A6 | `/api/metrics/model` returns the new grounding metric keys and extends `by_model` rows. |
| A7 | `/api/validations/{id}` exposes references + grounding, and the lecturer page renders the cited sources and the learning list. |
| A8 | With **zero** materials for a subject the pipeline behaves exactly as today (rubric-only), `suggested_materials_json = []`, grounding columns NULL. No regression. |
| A9 | Existing tests still pass; new tests cover chunking, citation validation, grounding math. |

---

## 2. Decisions (locked by the user, 2026-10-08)

- **R1** Similarity = **grounding / citation fidelity**: cosine between the embedding of the LLM's advice text and the embeddings of the passages it actually cited.
- **R2** Embeddings via **OpenRouter** `POST https://openrouter.ai/api/v1/embeddings`, model `openai/text-embedding-3-small`, `dimensions: 1536` → exact match to the existing `vector(1536)` column + HNSW index. **No schema change to `knowledge_chunks`.**
- **R3** Materials attach **per subject** (`subject_id` + optional `topic_id`).
- **R4** Output carries **both** inline source citations and a grounded learning list in `suggested_materials_json`.
- **R5** Grounding similarity is **stored per analysis** and **aggregated into `/api/metrics/model`**.
- **R6** Ingestion = `manage.py ingest_materials` **first**, lecturer upload page after.
- **R7** **Auto-chunk the whole document** (~800 tokens, overlap). No page-range selection.
- **R8** Retrieval wired into the **existing Modul B/C**; no new module.
- **R9** **Lecturer-only this increment.** Student feedback surface is out of scope.

### 2b. Defaults adopted for previously-open items (flag if any is wrong)

| Item | Adopted default |
|---|---|
| `/metrics` page | **Build a minimal `/metrics` page.** No page exists in this tree; an API-only metric is invisible. |
| Upload page placement | **New subject-scoped `/materials` route** in the lecturer area. |
| File storage | `MEDIA_ROOT/materials/<uuid>.<ext>`; **new** `MaterialsUploadView` (25 MB cap, `.pdf/.md/.txt`). Do NOT reuse `MediaUploadView` (image-only, 5 MB, `views.py:3254-3284`). |
| Retrieval filter | Subject-wide, **narrowed by the question set's mandatory topic when that topic has chunks** (migration `0008`). |
| `k` / threshold | `k = 5`, `similarity_threshold = 0.22` (settings-driven). |
| Pre-validation quality gate | **Not built.** The metric is left available for it later. |
| Re-ingest semantics | `--replace` matches on `(subject_id, title)` and replaces that document's chunks. |
| `prompt_templates` seed | **Left empty.** Prompt version stays a code constant. |
| Export (P7) | Out of scope. |

---

## 3. File-by-file change list

**New**

| Path | Purpose |
|---|---|
| `backend/api/embeddings.py` | Embedding client + cosine + grounding helpers |
| `backend/api/management/commands/ingest_materials.py` | Ingestion command |
| `backend/api/migrations/0024_grounding_and_knowledge_ingest.py` | Columns + `sp_record_llm_analysis` v3 |
| `backend/api/materials_views.py` | `MaterialListCreateView`, `MaterialDetailView` (upload/list/delete, lecturer-scoped) |
| `backend/api/tests_reference_materials.py` | Unit + integration tests |
| `frontend/app/materials/page.tsx` | Lecturer upload/list page |
| `frontend/app/metrics/page.tsx` | Minimal metrics page incl. grounding panel |

**Modified**

| Path | Change |
|---|---|
| `backend/api/models.py` | Add `KnowledgeDocument`, `KnowledgeChunk` read-models + 4 `LlmAnalysis` fields |
| `backend/api/llm.py` | Retrieval + prompt injection + citation validation + grounding columns; `PROMPT_VERSION` bump |
| `backend/api/validation_views.py` | `ValidationDetailView`: expose `concept_breakdown_json`, `references`, `what_should_be_learned`, grounding. `_compute_metrics`/`ModelMetricsView`: new keys + `by_model` rows |
| `backend/api/urls.py` | `materials`, `materials/<uuid>` routes |
| `backend/config/settings.py` | `EMBEDDINGS_*`, `RETRIEVAL_*` |
| `backend/requirements.txt` | `pymupdf` |
| `frontend/app/validation/[id]/page.tsx` | Render citations + learning list; fix the `concept_breakdown_json` drift |
| `frontend/app/lib/studentSubmissions.ts` | Extend the type |
| `frontend/app/components/*` (sidebar/nav) | Link to `/materials` (lecturer) |

---

## 4. Migration `0024_grounding_and_knowledge_ingest.py`

Hand-written `RunSQL`, reversible. **Numbered 0024, not 0023**: `0023_exam_package_expiry_behavior` landed on `main`
mid-build (HEAD moved from `a921845` to `e3c5b16`), so 0023 was taken. The highest existing migrations are now
`0023_exam_package_expiry_behavior` (a real, unrelated feature) and ours at `0024`.

**FORWARD**

```sql
-- (1) knowledge_documents ingestion state
ALTER TABLE knowledge_documents
    ADD COLUMN IF NOT EXISTS ingest_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS ingest_error  TEXT,
    ADD COLUMN IF NOT EXISTS chunk_count   INT;

-- (2) llm_analyses grounding columns
ALTER TABLE llm_analyses
    ADD COLUMN IF NOT EXISTS grounding_similarity      NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS grounding_similarity_max  NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS grounding_citation_count  INT,
    ADD COLUMN IF NOT EXISTS grounding_payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb;

-- (3) replace sp_record_llm_analysis (DROP first — see note)
DROP PROCEDURE IF EXISTS sp_record_llm_analysis(
    uuid, varchar, varchar, numeric, integer, jsonb, jsonb, text,
    numeric, jsonb, integer, varchar, varchar, varchar, varchar, varchar
);
-- then CREATE OR REPLACE PROCEDURE with the v3 signature in §4b
```

**Why DROP first:** the v3 signature adds parameters, so `CREATE OR REPLACE` would create an **overload**; a 16-arg call would then match two candidates → `function is not unique`. The old signature is exactly 16 IN + 1 OUT: `(uuid, varchar, varchar, numeric, integer, jsonb, jsonb, text, numeric, jsonb, integer, varchar, varchar, varchar, varchar, varchar)`.

> **VERIFIED LIVE (2026-10-08, dev DB `misconception_db` @ 5433).** That DB really does hold **two**
> overloads of `sp_record_llm_analysis`: `pronargs=11` (the original `V2_Full_Script.sql` version) and
> `pronargs=16` (four-tier, from `0011_four_tier_engine.py`). `0011` used `CREATE OR REPLACE` with a
> different signature, so it **added** an overload rather than replacing. This is not hypothetical:
> 0023 must `DROP PROCEDURE` the **16-arg** signature explicitly before creating v3, or it will add a
> third. Leave the 11-arg version alone (dead code; nothing calls it — the Django call site passes
> 16 values + `NULL`). The REVERSE must restore the **16**-arg version from `0011`, not the 11-arg one.

**REVERSE** must (a) drop the 7 columns added above, and (b) restore the previous procedure **verbatim**: drop the v3 signature and re-emit the v2 body copied from `api/migrations/0011_four_tier_engine.py` lines 113–206. After both directions verify with `SELECT prosrc FROM pg_proc WHERE proname='sp_record_llm_analysis'`.

### 4b. `sp_record_llm_analysis` v3

Append 4 IN params **with defaults**. The `OUT p_analysis_id UUID` must sit **immediately after the original 16 IN
params and BEFORE the 4 defaulted grounding params** — PostgreSQL rejects the obvious ordering with
`procedure OUT parameters cannot appear after one with a default value` (verified live against PG 16.15 on 2026-10-08).
This matches the shape `sp_submit_conceptual_answer` has used since `0011`.

```
IN  p_risk_level VARCHAR(20),
OUT p_analysis_id UUID,
IN  p_grounding_similarity NUMERIC(5,4) DEFAULT NULL,
IN  p_grounding_similarity_max NUMERIC(5,4) DEFAULT NULL,
IN  p_grounding_citation_count INT DEFAULT NULL,
IN  p_grounding_payload JSONB DEFAULT '{}'::jsonb
```

Body = the v2 body (`0011_four_tier_engine.py:133-205`) with the 4 new columns added to the `INSERT INTO llm_analyses` column list and `VALUES` list. Keep the `is_current`/`run_number` logic, the `ANALYZING`-state guard, the `fn_resolve_diagnostic_tier` call, `UPDATE submissions SET status='PENDING_VALIDATION'`, and the audit-log insert. Add the grounding values to the audit `metadata_json`.

---

## 5. Settings (`backend/config/settings.py`, after the existing LLM block at lines 154-160)

```python
# Embeddings (OpenRouter — dims MUST match the knowledge_chunks vector(1536) column)
EMBEDDINGS_BASE_URL = os.environ.get('EMBEDDINGS_BASE_URL', 'https://openrouter.ai/api/v1')
EMBEDDINGS_API_KEY  = os.environ.get('EMBEDDINGS_API_KEY', '')
EMBEDDINGS_MODEL    = os.environ.get('EMBEDDINGS_MODEL', 'openai/text-embedding-3-small')
EMBEDDINGS_DIMENSIONS = int(os.environ.get('EMBEDDINGS_DIMENSIONS', '1536'))

# Retrieval
RETRIEVAL_TOP_K = int(os.environ.get('RETRIEVAL_TOP_K', '5'))
RETRIEVAL_SIMILARITY_THRESHOLD = float(os.environ.get('RETRIEVAL_SIMILARITY_THRESHOLD', '0.22'))
```

**Secrets:** the key goes in `scripts/env_local.sh` (outside the repo, already gitignored) as `export EMBEDDINGS_API_KEY=...`. Never commit a key, never hardcode a fallback key.

---

## 6. `backend/api/embeddings.py`

```python
class EmbeddingError(Exception): ...

def get_embeddings_client() -> OpenAI:
    return OpenAI(base_url=settings.EMBEDDINGS_BASE_URL,
                  api_key=settings.EMBEDDINGS_API_KEY,
                  timeout=getattr(settings, 'LLM_TIMEOUT', 120.0))

def embed_texts(texts: list[str], batch_size: int = 64) -> list[list[float]]:
    """Batched embeddings. Retries with backoff; raises EmbeddingError on final failure.
    Validates every vector's length == settings.EMBEDDINGS_DIMENSIONS."""

def embed_text(text: str) -> list[float]: ...

def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Clamped to [-1, 1]; returns 0.0 on a zero-norm vector."""

def vector_literal(vec: Sequence[float]) -> str:
    """'[0.1,0.2,...]' — the text form to pass with a %s::vector cast."""
```

`grounded_similarity()` lives in `llm.py` (it needs the retrieved-chunk dicts and the payload shape).

---

## 7. `manage.py ingest_materials`

```
python manage.py ingest_materials <path> --subject <uuid|slug> [--topic <uuid|slug>]
       [--title "..."] [--replace] [--dry-run] [--limit-pages A-B] [--batch-size 64]
```

**Stages**

1. **Extract** — PDF via `pymupdf` (`import pymupdf; pymupdf.open(path)`; `page.get_text()`); `.md`/`.txt` read as UTF-8. Keep `pages = [(page_no, text), ...]` with 1-based page numbers. Light normalisation: collapse runs of 3+ spaces, drop page-number-only lines, strip the recurring running head.
2. **Chunk** — target `800` tokens, `15%` overlap. Approximate tokens as `len(text) / 4` and document that approximation in the code. Prefer splitting at blank lines, then sentence boundaries, then hard-split. Every chunk records `metadata_json = {"page_start": int, "page_end": int, "char_start": int, "char_end": int}` and `token_count = round(len(content)/4)`.
3. **Embed** — `embed_texts([c.content for c in chunks], batch_size)`; a failed batch is logged and reported, never silently dropped.
4. **Store** — insert one `knowledge_documents` row (`subject_id`, `topic_id`, `uploaded_by`, `title`, `file_path`, `mime_type`, `raw_text`) then bulk-insert `knowledge_chunks` (`document_id`, `subject_id`, `topic_id`, `chunk_index`, `content`, `token_count`, `embedding`, `metadata_json`). Commit per batch. Set `ingest_status='READY'` + `chunk_count` at the end; on failure `'FAILED'` + `ingest_error`. `embedding` written as a `%s::vector` cast using `vector_literal(...)`.
5. **Idempotency** — with `--replace`, find an existing document by `(subject_id, title)` and delete it first (`knowledge_chunks` cascades).
6. **`--dry-run`** — print document count, chunk count, total approx tokens, estimated USD cost (`tokens/1e6 * 0.02`) and exit **without** calling the API.

**Reference run for verification:** `D:/ClinicalAI_Misconception/References/Francis W. Sears, Gerhard L. Salinger-Thermodynamics, Kinetic Theory, and Statistical Thermodynamics-Addison Wesley (1975).pdf` — 462 pages, ~917k chars, ~230k tokens → expect **~290–330 chunks**, ~**$0.005**.

---

## 8. Retrieval + prompt integration (`backend/api/llm.py`)

### 8.1 New context fields
Add to `FourTierContext` (lines ~149-166): `topic_id: str | None`, `reference_chunks: list[dict]`. Extend `load_context`'s first SELECT to also return the question set's `topic_id` (`JOIN question_sets qs` already exists — add `qs.topic_id`).

### 8.2 Retrieval
```python
def retrieve_reference_chunks(subject_id, topic_id, query_text,
                              k=settings.RETRIEVAL_TOP_K,
                              threshold=settings.RETRIEVAL_SIMILARITY_THRESHOLD) -> list[dict]:
```
- Query text = `question_prompt + "\n" + tier1_answer + "\n" + tier3_reason`.
- `embed_text(query_text)` → `SELECT chunk_id, document_id, chunk_index, content, token_count, metadata_json, similarity FROM fn_search_knowledge_chunks(%s, %s::vector, %s, %s, %s)` (`V2_Full_Script.sql:1137-1162` — reuse, do not reimplement). Pass `p_topic_id = topic_id` only when that topic actually has chunks; otherwise `None`.
- **Failure is non-fatal**: any embedding/DB error → log, return `[]`, analysis proceeds rubric-only (A8). Never let retrieval failure mark a submission `ANALYSIS_FAILED`.

### 8.3 Prompt injection (Modul B and Modul C only — Modul A judges a ≤120-char conclusion)

Prepend to the user prompt:

```
SUMBER REFERENSI (Kutipan Buku Acuan — gunakan HANYA kutipan di bawah ini):
[S1] chunk_id=<uuid> | hal. <page_start> | <document title>
"<chunk content>"
[S2] ...
```

Add to the system prompt:

```
ATURAN SITASI:
1. Anda HANYA boleh mengutip chunk_id yang tercantum di bagian SUMBER REFERENSI.
2. Field "referensi" WAJIB berupa array objek {"chunk_id": "<uuid>", "kutipan": "<potongan kalimat>"}.
3. Jika tidak ada kutipan yang relevan, kembalikan "referensi": [].
```

Modul B's JSON schema gains `"referensi": [{"chunk_id": "...", "kutipan": "..."}]`. Modul C gains the same field.

### 8.4 New assembled output keys (`concept_breakdown` dict, llm.py:599-619)

```jsonc
{
  "module_a": {...}, "module_b": {"score": "...", "reasoning": "...", "referensi": [...]},
  "module_c": {...}, "decision_matrix": {...}, "student_feedback": {...},
  "heuristic_flags": [...], "percentage_correct": 0.0, "intervention": "...",

  "references": [ {"chunk_id","document_id","page","quote","similarity","valid","reason_if_invalid"} ],
  "what_should_be_learned": [ {"topik": "...", "sumber_chunk_ids": ["..."]} ],
  "grounding": {"similarity_mean": 0.0, "similarity_max": 0.0, "citation_count": 0}
}
```

All three are always present (empty/None when there are no chunks) so no consumer has to guess. `what_should_be_learned` is produced by **Modul B** (extend its schema with `"what_should_be_learned": [{"topik": "...", "sumber_chunk_ids": ["..."]}]`, grounded in the same references).

### 8.5 Citation validation + grounding

```python
def validate_citations(referensi, retrieved) -> list[dict]:
    # retrieved -> {chunk_id: chunk}
    # valid = chunk_id in retrieved
    # invalid: reason_if_invalid in {'not_in_retrieved_set', 'malformed'}
```

Grounding:
1. `advisory_text` = `module_b.student_feedback.konsep_seharusnya` + `" "` + `" | ".join(t.topik for t in what_should_be_learned)`.
2. valid citations only → `cosines = [cosine(embed_text(advisory_text), retrieved[cid]['embedding']) for cid in valid]`. **Chunk vectors must come from `knowledge_chunks.embedding`** — `fn_search_knowledge_chunks` does not return `embedding`, so extend the SQL call (or add a second query) to fetch embeddings for the retrieved chunk ids. Chunks are never re-embedded.
3. `similarity_mean = mean(cosines)`, `similarity_max = max(cosines)`, `citation_count = len(cosines)`. Zero valid citations → all three NULL.
4. Exactly **one** extra embedding call per analysis (the advisory text). Total embeddings per analysis = 2 (query + advisory).

### 8.6 Recording

`PROMPT_VERSION` → `'four-tier-v2.9-rag'` (line 37). Extend the `CALL sp_record_llm_analysis(...)` at lines 624-650 to 21 placeholders: the existing 16 values, then `NULL` at the **OUT slot**, then the 4 grounding values (`grounding_similarity`, `grounding_similarity_max`, `grounding_citation_count`, `grounding_payload_json`) — 20 values + 1 NULL. Named notation (`p_grounding_similarity => ...`) also works. **Cast every placeholder** (`%s::numeric`, `%s::jsonb`, `%s::integer`, `%s::varchar`, …) — a bare `%s` sends int4/unknown and PG answers `procedure does not exist`. `suggested_materials_json` is no longer `json.dumps([])` — write the `what_should_be_learned` list.

---

## 9. Metrics (`backend/api/validation_views.py`)

Extend `_compute_metrics` (lines 402-494) and the `by_model` rows (lines 543-558).

```
grounding_similarity_mean     mean of grounding_similarity over analyses with citation_count >= 1
grounding_similarity_median   median of the same
citation_coverage             analyses_with_citation_count>=1 / analyses_total   (4dp)
citation_validity_rate        valid_citations / all_citations                    (4dp, null if 0)
hallucinated_citation_rate    1 - citation_validity_rate
grounding_by_category         { four_tier_category: {count, similarity_mean} }
grounding_by_prompt_version   { prompt_version: {count, similarity_mean} }
no_grounding_count            analyses_total - analyses_with_citations
```

These are **properties of the analysis, not of the validation** — compute from `analysis` rows and document in the docstring that no lecturer validation is required. Never present them as accuracy. Round to 4dp like the existing metrics. Keep the existing `note` field and extend it to state that grounding needs no ground truth.

---

## 10. API + frontend

### 10.1 `ValidationDetailView` (lines 199-245)
Add to the `llm` dict: `'concept_breakdown_json': breakdown`, `'references': breakdown.get('references') or []`, `'what_should_be_learned': breakdown.get('what_should_be_learned') or []`, `'grounding_similarity': float(a.grounding_similarity) if a.grounding_similarity is not None else None`, `'grounding_payload': a.grounding_payload_json or {}`, `'suggested_materials': a.suggested_materials_json or []`.

**Also fixes a live bug:** `frontend/app/validation/[id]/page.tsx:164` reads `det.llm.concept_breakdown_json?.misconception_matches` but the backend never returns `concept_breakdown_json`, so the confirm/deny UI renders `[]` today. Adding the key fixes it — verify the UI actually populates.

### 10.2 `frontend/app/validation/[id]/page.tsx`
Add a **"Sumber Referensi"** block: per citation the document title + page + quote + similarity, with a prominent warning style for `valid: false`. Add a **"Yang Perlu Dipelajari"** list from `what_should_be_learned`. Show `grounding_similarity` as a labelled score with a plain-language caveat ("bukan akurasi; mengukur keselarasan dengan sumber").

### 10.3 `frontend/app/materials/page.tsx`
Subject-scoped (reuse the `/questions` subject-picker pattern): upload PDF/MD/TXT, list documents with `ingest_status`/`chunk_count`, allow delete. Match the existing design system — do not invent new styling.

### 10.4 `frontend/app/metrics/page.tsx`
Minimal: the existing `/api/metrics/model` payload (tier agreement, macro-F1, MAE/RMSE, ECE, rejection rate) **plus** a grounding panel (mean/median, coverage, validity rate, hallucinated rate, per-category). API-only metrics are invisible; this page is why the work exists.

### 10.5 `frontend/app/lib/studentSubmissions.ts`
Extend the declared types with the citation shape and `what_should_be_learned`.

---

## 11. Tests

`backend/api/tests_reference_materials.py` (+ keep `tests.py` green):

1. Chunking: synthetic 3-page doc → chunk count in range, no chunk exceeds ~1.1× target, every chunk has `page_start`/`page_end`, overlap present between consecutive chunks of the same page.
2. `cosine()`: identical vectors → 1.0; orthogonal → 0.0; zero vector → 0.0 (no ZeroDivisionError).
3. `validate_citations`: unknown `chunk_id` → `valid False`, `not_in_retrieved_set`, excluded from the count.
4. Grounding math: monkeypatch embeddings → assert `similarity_mean` equals the mean of injected cosines.
5. Zero-chunk path: no materials for the subject → `suggested_materials_json == []`, grounding columns NULL, analysis still reaches `PENDING_VALIDATION` (A8).
6. Migration: forward → reverse → forward against a scratch DB (skip when unavailable).
7. Ingestion `--dry-run` must make **zero** network calls (assert the embeddings client is never constructed).

Extend the existing API E2E (`scripts/test_p5_e2e.py`, outside the repo/gitignored) with grounding assertions.

---

## 12. Verification evidence required in the final report

- `python manage.py check` clean; `migrate` forward + reverse + forward clean.
- `ingest_materials <sears pdf> --subject <physics> --dry-run` output (pages/chunks/tokens/cost).
- Real ingestion: `SELECT count(*), count(embedding) FROM knowledge_chunks WHERE document_id = ...;`
- `SELECT * FROM fn_search_knowledge_chunks(<subject>, '<vector literal>', NULL, 5, 0.2);` showing real passages.
- One real submission through `manage.py analyze_submissions` with non-null `grounding_similarity`, populated `suggested_materials_json`, and `grounding_payload_json` listing citations.
- `curl` of `/api/metrics/model` and `/api/validations/{id}` (authenticated) with the new keys present.
- A browser pass on `/validation/{id}` and `/metrics` showing citations, learning list, grounding numbers.
- Regression: one submission on a subject with **no** materials still analyses identically to today.
- `git log --oneline` of the phase commits.

---

## 13. Must-not-do list

1. Do not run `makemigrations`.
2. Do not re-import `V2_Full_Script.sql`.
3. Do not re-embed chunks at analysis time (`knowledge_chunks.embedding` is the source of truth).
4. Do not let retrieval failure fail the analysis.
5. Do not cite chunks the LLM invented — invalid citations are recorded, never counted.
6. Do not change `EMBEDDINGS_DIMENSIONS` away from 1536 without a migration (the column is `vector(1536)`).
7. Do not reuse `MediaUploadView` for PDFs.
8. Do not present grounding similarity as accuracy anywhere in the UI or API notes.
9. Do not touch the student feedback surface (out of scope) or another profile's files.
10. Do not commit secrets.

---

## 14. Environment prerequisites (owner: the user)

| # | Need | Why |
|---|---|---|
| P1 | **pgvector on the dev DB.** Docker Desktop is currently **not running**; nothing listens on 5432-5435. The repo's compose postgres (pgvector image) is the intended dev DB. Alternatively install pgvector into the PG18 cluster at `D:/pg_acm` — `C:/Program Files/PostgreSQL/18/share/extension/vector*` **does not exist**, and that harness was deliberately loaded with the vector column and `fn_search_knowledge_chunks` **stripped**. | Without pgvector, `vector(1536)` and `fn_search_knowledge_chunks` cannot exist. |
| P2 | **`EMBEDDINGS_API_KEY`** (OpenRouter) written by the owner into `scripts/env_local.sh` (outside the repo). | Embedding ingestion + retrieval. |
| P3 | Confirm the real-PDF chunking numbers (~300 chunks, ~$0.005). | Cost/scale sanity. |
| P4 | `pip install pymupdf` into `backend/venv` (`openai>=1.50.0` already present; pymupdf absent). | PDF extraction. |

---

## 15. Out of scope

Student feedback surface (R9) · P6 profiles · P7 export · P9 admin · seeding `prompt_templates` · `LLM_CANDIDATE` misconception promotion · pre-validation quality gate · re-ranking / hybrid search.