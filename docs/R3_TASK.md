# R3 TASK — retrieval + prompt injection + grounding recording in `llm.py`

You are implementing **PHASE R3 ONLY** of the reference-materials feature.
Authoritative spec: `docs/REFERENCE_MATERIALS_IMPLEMENTATION_BRIEF.md` — read **§8** (lines 227–298) first, it is
the complete contract for this phase. Also read §13 (must-not-do list).
Implement R3 and **nothing** from later phases (no metrics endpoints, no API view changes, no frontend, no UI).

State you must trust (already verified, do not redo):
- R1 commit `38fdf2c`: migration `0024` applied — `llm_analyses` has `grounding_similarity`,
  `grounding_similarity_max`, `grounding_citation_count`, `grounding_payload_json`;
  `sp_record_llm_analysis` has 11-arg (legacy, dead) and **20-arg (v3, current)** overloads — call shape is
  `(16 values, NULL at the OUT slot, 4 grounding values)`.
- R2 commit `7c50c2e`: `backend/api/embeddings.py` provides `embed_text`, `embed_texts`, `cosine`,
  `vector_literal`, `EmbeddingError`. Physics subject `cfc7f58c-eeb8-451e-95e7-14c721e9574b` has a Sears
  Thermodynamics document ingested (**329 chunks**, all with non-null `vector(1536)` embeddings, verified via a
  real `fn_search_knowledge_chunks` query).
- `fn_search_knowledge_chunks(p_subject_id uuid, p_query_embedding vector, p_topic_id uuid DEFAULT NULL,
  p_match_count int DEFAULT 5, p_similarity_threshold float DEFAULT 0.0)` — reuse it, do not reimplement.
- Current `llm.py` facts: `PROMPT_VERSION = 'four-tier-v2.8'` (line 37); `FourTierContext` (line 149);
  `load_context` (line 169); assembled `concept_breakdown` dict (lines 599–619); `CALL sp_record_llm_analysis`
  with 17 placeholders (16 values + NULL at OUT slot, lines 624–650). Total file is 668 lines.

## Deliverables (all in `backend/api/llm.py` unless stated)

1. **Context fields (§8.1)** — add `topic_id: str | None` and `reference_chunks: list[dict]` to
   `FourTierContext`; extend `load_context`'s first SELECT with `qs.topic_id`.

2. **Retrieval (§8.2)** — `retrieve_reference_chunks(subject_id, topic_id, query_text, k, threshold)`.
   - Query text = `question_prompt + "\n" + tier1_answer + "\n" + tier3_reason`.
   - `embed_text(query_text)` → `SELECT ... FROM fn_search_knowledge_chunks(%s, %s::vector, %s, %s, %s)`
     using `vector_literal(...)`. Pass `p_topic_id` only when that topic actually has chunks, else `None`.
   - Then a **second query** fetching `embedding` for the retrieved chunk ids
     (`fn_search_knowledge_chunks` does not return it) so grounding cosines can be computed.
   - **Non-fatal:** any embedding/DB error → `logger.warning`, return `[]`; the analysis MUST proceed
     rubric-only. Retrieval failure must never set `ANALYSIS_FAILED`.
   - Call it once per analysis inside `analyze_submission` (after `load_context`) and stash the result on the
     context (`reference_chunks`).

3. **Prompt injection (§8.3)** — Modul B **and** Modul C only (Modul A untouched).
   - Prepend the `SUMBER REFERENSI (Kutipan Buku Acuan...)` block — exactly the format in §8.3 with
     `[S1] chunk_id=<uuid> | hal. <page_start> | <document title>` + quoted chunk content. Skip when
     `reference_chunks` is empty (zero-chunk subject → the prompts today, byte-identical).
   - Add the `ATURAN SITASI` block to the system prompt (the 3 rules verbatim from §8.3).
   - Both JSON schemas gain `"referensi": [{"chunk_id": "...", "kutipan": "..."}]` (Modul B) and the same
     field (Modul C). Modul B also gains `"what_should_be_learned": [{"topik": "...", "sumber_chunk_ids": [...]}]`
     (§8.4). Parse defensively: missing key → empty list; non-dict entries dropped; `chunk_id` cast to str.
   - Teacher-facing text stays Indonesian.

4. **Citation validation + grounding (§8.5)**
   - `validate_citations(referensi, retrieved) -> list[dict]`: `retrieved` keyed by chunk_id; valid iff
     chunk_id in retrieved; invalid reason ∈ {'not_in_retrieved_set', 'malformed'}; each entry carries
     `{chunk_id, document_id, page, quote, similarity, valid, reason_if_invalid}` (page/similarity from the
     retrieved chunk when valid).
   - `advisory_text` = `student_feedback['konsep_seharusnya'] + " " + " | ".join(t['topik'])`.
   - Cosines = `cosine(embed_text(advisory_text), chunk_embedding)` over **valid** citations only, using the
     stored chunk embeddings fetched in step 2 — never re-embed a chunk. Exactly **one** extra embedding call
     per analysis (advisory; total = 2: query + advisory).
   - `similarity_mean` = mean of cosines, `similarity_max` = max, `citation_count` = number of valid cosines.
     Zero valid citations → all three `None` (Python) / NULL (SQL).

5. **New `concept_breakdown` keys (§8.4)** — always present, even when empty:
   `references` (the validated citation list), `what_should_be_learned` (the Modul B list),
   `grounding: {similarity_mean, similarity_max, citation_count}`.

6. **Recording (§8.6)**
   - `PROMPT_VERSION` → `'four-tier-v2.9-rag'`.
   - Extend the CALL to **21 placeholders**: the existing 16 values, `NULL` at the OUT slot, then
     `grounding_similarity`, `grounding_similarity_max`, `grounding_citation_count`,
     `grounding_payload_json`. **Cast every placeholder** (`%s::numeric`, `%s::jsonb`, `%s::integer`,
     `%s::varchar`…) — a bare `%s` sends int4/unknown and PG answers "procedure does not exist".
   - `suggested_materials_json` slot (currently `json.dumps([])`) → the `what_should_be_learned` list.
   - `grounding_payload_json` = `{"references": [...], "grounding": {...}}`-style audit payload per §8.4/§8.5 —
     make sure the audit trail carries every citation with its validity verdict.
   - Raw SQL note: the current call passes 17 args positionally with `NULL` in the right slot; place the 4
     grounding values after that `NULL`.

7. **Tests — `backend/api/tests_reference_materials.py`** (new file; brief §11, the subset applicable to R3):
   - `cosine()`: identical → 1.0, orthogonal → 0.0, zero vector → 0.0, no exception.
   - `validate_citations`: unknown chunk_id → `valid: False`, reason `not_in_retrieved_set`, excluded from count.
   - Grounding math: monkeypatch `embed_text` (or the embeddings module) → `similarity_mean` equals the mean of
     the injected cosines; zero valid citations → all-None.
   - Zero-chunk path: subject with no materials → reference_chunks empty, Modul B/C prompts unchanged,
     suggested_materials `[]`, grounding columns NULL, pipeline still reaches `PENDING_VALIDATION`.
   Do NOT create DB-dependent fixtures against the shared dev DB; monkeypatch or use transactions
   (`TestCase` rollbacks). Run with `venv/Scripts/python.exe manage.py test api.tests_reference_materials -v 2`.

## Live facts to respect

- Physics subject has 329 ingested chunks — real analyses against it WILL retrieve passages; good.
- Other subjects have none — they exercise the zero-chunk path (A8 regression required by §12).
- The 20-arg overload's 4 grounding params are trailing `IN` params; pass positionally after the OUT `NULL`.

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- Do not re-embed chunks at analysis time (only the query text and advisory text get embedded — 2 calls).
- Retrieval failure must never fail an analysis (rule 4 in HANDOFF).
- Do not touch `validation_views.py`, urls, any frontend file, `tests.py`, or the ingest command.
- Never present grounding similarity as accuracy (it is advice-source alignment, documented as such).

## Environment

Before **every** `manage.py` call:

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

That file is **outside** this repo. Interpreter: `backend/venv/Scripts/python.exe` (run from `backend/`).
DB: docker `misconception_db` at `127.0.0.1:5433`, db `misconception_system`, user `postgres`;
`psql` via `docker exec misconception_db psql -U postgres -d misconception_system -tAc "..."`.

## Verification — run all and paste the RAW output

1. `venv/Scripts/python.exe manage.py check`
2. `venv/Scripts/python.exe manage.py test api.tests_reference_materials -v 2` (all green)
3. `venv/Scripts/python.exe manage.py analyze_submissions` (or the single-submission path) against a REAL
   Physics submission whose question touches thermodynamics → then:
   `docker exec ... -tAc "SELECT grounding_similarity, grounding_similarity_max, grounding_citation_count,
   jsonb_array_length(grounding_payload_json->'references'), left(suggested_materials_json::text,200),
   prompt_version FROM llm_analyses WHERE submission_id = '<id>' ORDER BY run_number DESC LIMIT 1;"`
   → non-null similarity, citations ≥ 1, `prompt_version = four-tier-v2.9-rag`.
4. Regression: one submission on a subject with NO materials → analysis reaches `PENDING_VALIDATION`,
   grounding columns NULL, `suggested_materials_json = '[]'`.
5. Show that a retrieval outage does not hard-fail: temporarily set `EMBEDDINGS_BASE_URL` to an unreachable
   URL in the env, re-run one submission, confirm `PENDING_VALIDATION` (not `ANALYSIS_FAILED`) and a restored
   env afterwards.

## Finish

Commit exactly:

```
feat(api): R3 retrieval and grounding in llm analysis pipeline
```

Report back: files changed, raw verification output (test run + the two SQL checks + outage check), commit
hash. **Do not start R4.**
