# C1 TASK — Migration 0025: answer-similarity + shadow columns, reference-answer hash/embedding, sp v4

You are implementing **PHASE C1 ONLY** of the answer-cosine / reading-material change.
Authoritative spec: `docs/COSINE_READING_MATERIAL_BRIEF.md` — **revision 2, 2026-10-14** — read §1, §2,
§10, §11 first. Decision record: `../Context/Answer_Cosine_Plan.md` (D1–D15, outside the repo).
Implement C1 and **nothing** from later phases (no sync command, no threshold logic, no generation, no
UI). In particular: **do not touch `backend/api/llm.py`** — its 21-placeholder `CALL` must keep working
untouched, and proving that is part of this phase.

## Deliverables

1. **`backend/api/migrations/0025_answer_similarity_and_reference_embeddings.py`** — hand-written
   reversible `RunSQL`. **7 columns:**

   ```sql
   ALTER TABLE reference_answers
       ADD COLUMN IF NOT EXISTS embedding   vector(1536),
       ADD COLUMN IF NOT EXISTS answer_hash CHAR(64);

   ALTER TABLE llm_analyses
       ADD COLUMN IF NOT EXISTS answer_similarity_t1 NUMERIC(5,4),
       ADD COLUMN IF NOT EXISTS answer_similarity_t3 NUMERIC(5,4),
       ADD COLUMN IF NOT EXISTS llm_t1_score         VARCHAR(20),
       ADD COLUMN IF NOT EXISTS llm_t3_score         VARCHAR(20),
       ADD COLUMN IF NOT EXISTS verdict_shadow_json  JSONB NOT NULL DEFAULT '{}'::jsonb;
   ```

   - `answer_hash` is the change-detection key for C2's `sync_reference_embeddings` — sha256 of the
     *effective* reference text. C1 only creates the column; C2 fills it.
   - **`verdict_shadow_json` is not optional.** The shadow verdict is only reproducible if the θ in
     force is recorded with it. Its shape is
     `{rule_t1, rule_t3, sim_t1, sim_t3, threshold_t1, threshold_t3, source}`; C3 populates it. Say so
     in the migration docstring.
   - **No** `misconception_id` anywhere (D12). **No** `verdict_source` column — the setting selects the
     `PROMPT_VERSION` string, which `llm_analyses.prompt_version` already records.
   - **No** index on `reference_answers.embedding`.

2. **`sp_record_llm_analysis` → v4.** `DROP PROCEDURE` the **20-arg** signature by its exact argument
   types (copy them from `0024_grounding_and_knowledge_ingest.py:63`). Append the **5** new IN params
   **after** the grounding params, each `DEFAULT NULL`, `OUT p_analysis_id UUID` last. Result:
   `pronargs` 20 → **25**. Body = the v3 body with the 5 new columns added to the
   `INSERT INTO llm_analyses` column list and `VALUES` list, and to the audit `metadata_json`.

   **Reverse** drops exactly the 7 columns and restores the **v3 (20-arg)** body verbatim from `0024`.

3. **`backend/api/models.py`** — add the 5 new `LlmAnalysis` fields, and `embedding` + `answer_hash`
   on the `ReferenceAnswer` model.

4. **`backend/config/settings.py`** — declare the C3/C4 settings block from brief §4, after the
   existing `RETRIEVAL_*` block. C1 only *declares* them; nothing reads them yet.

   | Setting | Default |
   |---------|---------|
   | `TIER_VERDICT_SOURCE` | **`'llm'`** |
   | `SHADOW_RULE_VERDICT` | `True` |
   | `ANSWER_SIM_T1_THRESHOLD` | `0.75` |
   | `ANSWER_SIM_T3_THRESHOLD` | `0.75` |
   | `READING_MATERIAL_TEMPERATURE` | `0.0` |
   | `READING_MATERIAL_MAX_RUNS` | `3` |
   | `READING_MATERIAL_DRAIN_BATCH` | `10` |

   `TIER_VERDICT_SOURCE` is `'llm'`, **not** `'rule'`. `'rule'` would let an uncalibrated threshold
   drive `SC`/`MSC` flips. Do not "fix" this default.

## Live facts you must respect

- Two overloads exist: `pronargs = 11` (legacy `V2_Full_Script.sql`, dead) and `pronargs = 20` (v3, from
  `0024`). `CREATE OR REPLACE` with a new signature adds a **third**. Drop the 20-arg one explicitly
  and **leave the 11-arg one alone**.
- The caller currently passes **21** placeholders. **Do not change `llm.py`.** The 21-placeholder call
  must keep resolving against the 25-arg procedure via the trailing defaults — prove it by execution
  (verification 4).
- `knowledge_chunks.embedding` is already `vector(1536)` with `idx_knowledge_chunks_vector_hnsw`. Do not
  touch either, and do not add an index to `reference_answers.embedding`.
- `question_versions.short_answer` is **nullable**. Nothing in C1 makes it non-null.
- Highest migration is `0024`. Do not create a duplicate leaf (`0016`/`0018`, `0019`/`0020`).
- The dev DB is the **evidence base, not a test DB** — never insert app data to make a check pass. That
  is why verification 4 rolls back.

## Hard rules

- **Never** run `makemigrations`. (0001_initial declares only User/AuthToken; the autodetector would
  create a bogus migration for every unmanaged model.)
- **Never** re-import `V2_Full_Script.sql`.
- The migration must be reversible and must be exercised **in both directions**.
- Do not overload the 4 existing `grounding_*` columns on `llm_analyses` — historical R1–R6 rows must
  stay interpretable.

## Environment

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

That file is **outside** this repo (parent directory). Interpreter `backend/venv/Scripts/python.exe`.
DB: docker `misconception_db`, `127.0.0.1:5433`, `misconception_system`, user `postgres`.

**Cold start:** Docker Desktop is often **off** and the container is stopped by default.
`docker start misconception_db` fails with `npipe:////./pipe/dockerDesktopLinuxEngine ... cannot find
the file specified`. Start `"C:\Program Files\Docker\Docker\Docker Desktop.exe"` via
`powershell.exe -NoProfile -Command "Start-Process ..."`, poll
`docker info --format '{{.ServerVersion}}'` (≈10 s), then `docker start misconception_db` and
`pg_isready` (≈1 s).

## Verification — run all of these and paste the RAW output

1. `venv/Scripts/python.exe manage.py check`
2. Baseline: `venv/Scripts/python.exe manage.py test api.tests_reference_materials` — record the count
   the runner prints. Expected **36**; the old HANDOFF's 34 is wrong, so do not adjust anything to
   match it.
3. `venv/Scripts/python.exe manage.py migrate` → `0025` applies; then `migrate api 0024` → reverse; then
   `migrate` → forward again.
4. **Backward compatibility BY EXECUTION** — the acceptance test for this phase. Run the *existing*
   21-placeholder `CALL` against the migrated DB, inside a transaction that is rolled back so the
   evidence base gains no row:

   ```sql
   BEGIN;
   CALL sp_record_llm_analysis(<an existing submissions.id>, <the 16 v3 values>, NULL, <the 4 grounding values>);
   SELECT count(*) FROM llm_analyses WHERE submission_id = <that id>;   -- proves the write landed
   ROLLBACK;
   ```

   Then the same with the full **26** placeholders, also rolled back. Paste both outputs. Reading
   `pg_proc` is **corroboration only** — it is not evidence that the old call still resolves.
5. After **each** migration direction:

   ```bash
   docker exec misconception_db psql -U postgres -d misconception_system -tAc "SELECT proname, pronargs FROM pg_proc WHERE proname = 'sp_record_llm_analysis' ORDER BY pronargs;"
   ```

   Expected `11` and `20` before; `11` and **`25`** after forward; back to `11`/`20` after reverse.
6. Column presence, both directions (expect **7** rows after forward, **0** after reverse):

   ```bash
   docker exec misconception_db psql -U postgres -d misconception_system -tAc "SELECT table_name||'.'||column_name||' '||data_type FROM information_schema.columns WHERE (table_name='llm_analyses' AND (column_name LIKE 'answer_similarity%' OR column_name LIKE 'llm_t%_score' OR column_name='verdict_shadow_json')) OR (table_name='reference_answers' AND column_name IN ('embedding','answer_hash')) ORDER BY 1;"
   ```

7. Confirm `knowledge_chunks.embedding` is still `vector(1536)` with
   `idx_knowledge_chunks_vector_hnsw` intact, and that the 4 pre-existing `grounding_*` columns on
   `llm_analyses` are untouched.
8. `git diff --stat backend/api/llm.py` → **empty**. The C1 commit must not touch `llm.py`.

## Finish

Commit exactly:

```
feat(api): migration 0025 answer-similarity and shadow columns, sp_record_llm_analysis v4
```

Report back: files changed, raw verification output, commit hash. **Do not start C2.**
