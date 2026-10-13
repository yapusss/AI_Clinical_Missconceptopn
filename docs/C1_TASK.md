# C1 TASK — Migration 0025: answer-similarity columns + reference-answer embedding + sp v4

You are implementing **PHASE C1 ONLY** of the answer-cosine / reading-material change.
Authoritative spec: `docs/COSINE_READING_MATERIAL_BRIEF.md` (read it first — §1, §2, §9, §10).
Decision record: `../Context/Answer_Cosine_Plan.md` (outside the repo).
Implement C1 and **nothing** from later phases (no embeddings command, no threshold logic, no
generation, no UI).

## Deliverables

1. **`backend/api/migrations/0025_answer_similarity_and_reference_embeddings.py`** — hand-written
   reversible `RunSQL` per brief §2.
   - `reference_answers`: add `embedding vector(1536) NULL`.
   - `llm_analyses`: add `answer_similarity_t1 NUMERIC(5,4) NULL`,
     `answer_similarity_t3 NUMERIC(5,4) NULL`, `llm_t1_score VARCHAR(20) NULL`,
     `llm_t3_score VARCHAR(20) NULL`.
   - Replace `sp_record_llm_analysis` with **v4**: `DROP PROCEDURE` the **20-arg** signature by its
     exact argument types (copy them from `0024_grounding_and_knowledge_ingest.py:63`), then
     `CREATE OR REPLACE` with the 4 new IN params appended **after** the grounding params, each
     `DEFAULT NULL`, keeping `OUT p_analysis_id UUID` last. Body = the v3 body with the 4 new columns
     added to the `INSERT INTO llm_analyses` column list and `VALUES` list, and to the audit
     `metadata_json`.
   - **Reverse** must drop exactly the 5 columns added and restore the **v3 (20-arg)** procedure body
     verbatim from `0024_grounding_and_knowledge_ingest.py`.
   - **Do NOT** add a `verdict_source` column (brief §2 explains why: the setting picks the
     `PROMPT_VERSION` string, which `llm_analyses.prompt_version` already records per row).

2. **`backend/api/models.py`** — add the 4 new `LlmAnalysis` fields and `embedding` on the
   `ReferenceAnswer` model.

3. **`backend/config/settings.py`** — add the settings block from brief §4
   (`ANSWER_SIM_T1_THRESHOLD`, `ANSWER_SIM_T3_THRESHOLD`, `TIER_VERDICT_SOURCE`,
   `CROSSCHECK_LLM_VERDICT`, `GENERATION_MISCONCEPTION_CONFIDENCE`, `READING_MATERIAL_TEMPERATURE`),
   placed after the existing `RETRIEVAL_*` block. **C3 consumes them; C1 only declares them.**

4. **`backend/api/management/commands/__init__.py`** — create if absent.

Nothing else. Do **not** wire the thresholds into `llm.py` in this phase.

## Live facts you must respect

- Two overloads of `sp_record_llm_analysis` exist: `pronargs = 11` (legacy `V2_Full_Script.sql`, dead)
  and `pronargs = 20` (v3, from `0024`). `CREATE OR REPLACE` with a new signature would add a
  **third**. Drop the 20-arg signature explicitly and **leave the 11-arg one alone**.
- The caller (`backend/api/llm.py:944-977`) currently passes **21** placeholders. After C1 the
  procedure takes 24 IN args, so the `CALL` needs **25** placeholders. **Do not change `llm.py` in
  this phase** — instead confirm by reading the file that the call site is untouched, and prove the
  arity change with `pg_proc` only. (C3 updates the call site.)
- `knowledge_chunks.embedding` is already `vector(1536)` with `idx_knowledge_chunks_vector_hnsw`. Do
  not touch it, do not add an index to `reference_answers.embedding`.
- `question_versions.short_answer` is **nullable**. Nothing in C1 makes it non-null.
- Migration `0024` is the highest. Do not create a duplicate leaf (the repo has a merge-migration
  pattern: `0016`/`0018`, `0019`/`0020`).

## Hard rules

- **Never** run `makemigrations`. (0001_initial declares only User/AuthToken; the autodetector would
  create a bogus migration for every unmanaged model.)
- **Never** re-import `V2_Full_Script.sql`.
- The migration must be reversible and must actually be exercised **in both directions**.
- Do not overload the existing `grounding_*` columns. Historical R1–R6 rows must stay interpretable.

## Environment

Before **every** `manage.py` / `psql` call:

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

That file is **outside** this repo (in the parent directory). Interpreter:
`backend/venv/Scripts/python.exe`. DB: docker container `misconception_db`, postgres at
`127.0.0.1:5433`, db `misconception_system`, user `postgres`. **The container is stopped by
default** — `docker start misconception_db` first, and wait for readiness before the first query.

## Verification — run all of these and paste the RAW output

1. `venv/Scripts/python.exe manage.py check`
2. Baseline first: `venv/Scripts/python.exe manage.py test api.tests_reference_materials` — record the
   test count (expected **36**, not the 34 the old HANDOFF claims).
3. `venv/Scripts/python.exe manage.py migrate` → `0025` applies
4. `venv/Scripts/python.exe manage.py migrate api 0024` → reverse
5. `venv/Scripts/python.exe manage.py migrate` → forward again
6. After **each** direction:
   ```bash
   docker exec misconception_db psql -U postgres -d misconception_system -tAc "SELECT proname, pronargs FROM pg_proc WHERE proname = 'sp_record_llm_analysis' ORDER BY pronargs;"
   ```
   Expected: `11` and `20` before; `11` and `24` after forward; back to `11`/`20` after reverse.
7. Column presence, both directions:
   ```bash
   docker exec misconception_db psql -U postgres -d misconception_system -tAc "SELECT column_name, data_type FROM information_schema.columns WHERE (table_name='llm_analyses' AND column_name LIKE 'answer_similarity%') OR (table_name='llm_analyses' AND column_name LIKE 'llm_t%_score') OR (table_name='reference_answers' AND column_name='embedding') ORDER BY 1;"
   ```
   Expected: 5 rows after forward, 0 after reverse.
8. Confirm `knowledge_chunks.embedding` is still `vector(1536)` and
   `idx_knowledge_chunks_vector_hnsw` still exists.
9. Confirm the 4 pre-existing `grounding_*` columns on `llm_analyses` are untouched.
10. Confirm `backend/api/llm.py` is unmodified: `git diff --stat backend/api/llm.py` → empty.

## Finish

Commit exactly:

```
feat(api): migration 0025 answer-similarity columns and sp_record_llm_analysis v4
```

Report back: files changed, raw verification output, commit hash. **Do not start C2.**
