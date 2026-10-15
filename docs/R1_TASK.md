# R1 TASK — Migration 0023 + settings + models

You are implementing **PHASE R1 ONLY** of the reference-materials feature.
Authoritative spec: `docs/REFERENCE_MATERIALS_IMPLEMENTATION_BRIEF.md` (read it first — especially §4, §4b, §5).
Implement R1 and **nothing** from later phases (no ingestion command, no embeddings module, no prompt wiring, no UI).

## Deliverables

1. **`backend/api/migrations/0023_grounding_and_knowledge_ingest.py`** — hand-written reversible `RunSQL` per brief §4 and §4b.
   - Add to `llm_analyses`: `grounding_similarity NUMERIC(5,4) NULL`, `grounding_similarity_max NUMERIC(5,4) NULL`,
     `grounding_citation_count INT NULL`, `grounding_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb`.
   - Add to `knowledge_documents`: `ingest_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'`, `ingest_error TEXT`,
     `chunk_count INT`.
   - Replace `sp_record_llm_analysis` with **v3**: `DROP PROCEDURE` the **16-arg** signature by exact argument types,
     then `CREATE OR REPLACE` with the 4 new IN params appended **with `DEFAULT NULL`**, keeping `OUT p_analysis_id UUID` last.
     Body = the v2 body (`0011_four_tier_engine.py` lines 133–205) with the 4 new columns added to the `INSERT INTO
     llm_analyses` column list and `VALUES` list. Add the grounding values to the audit `metadata_json`.
   - **Reverse** must drop exactly the 7 columns added and restore the **16-arg** procedure body verbatim from
     `backend/api/migrations/0011_four_tier_engine.py` lines 113–206.

2. **`backend/api/models.py`** — add `KnowledgeDocument` and `KnowledgeChunk` read-models (`managed = False`,
   `db_table = 'knowledge_documents'` / `'knowledge_chunks'`) and the 4 new `LlmAnalysis` fields.

3. **`backend/config/settings.py`** — add the `EMBEDDINGS_*` and `RETRIEVAL_*` block from brief §5, after the existing
   LLM block (around lines 154–160).

4. **`backend/requirements.txt`** — add `pymupdf` (already pip-installed in `backend/venv`).

## Live facts you must respect

- The dev DB currently has **TWO overloads** of `sp_record_llm_analysis`: `pronargs = 11` (original `V2_Full_Script.sql`)
  and `pronargs = 16` (four-tier, from migration `0011`). `CREATE OR REPLACE` with a new signature would add a **third**.
  You MUST drop the 16-arg signature explicitly. **Leave the 11-arg version alone** (dead code).
- `knowledge_chunks.embedding` is already `vector(1536)` with index `idx_knowledge_chunks_vector_hnsw`. Do not touch it.

## Hard rules

- **Never** run `makemigrations`. (0001_initial declares only User/AuthToken; the autodetector would create a bogus
  migration for every unmanaged model.)
- **Never** re-import `V2_Full_Script.sql`.
- The migration must be reversible and must actually be exercised in both directions.

## Environment

Before **every** `manage.py` call:

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

That file is **outside** this repo (in the parent directory). Interpreter: `backend/venv/Scripts/python.exe`.
DB: docker container `misconception_db`, postgres at `127.0.0.1:5433`, db `misconception_system`, user `postgres`.

## Verification — run all of these and paste the RAW output

1. `venv/Scripts/python.exe manage.py check`
2. `venv/Scripts/python.exe manage.py migrate` → 0023 applies
3. `venv/Scripts/python.exe manage.py migrate api 0022` → reverse
4. `venv/Scripts/python.exe manage.py migrate` → forward again
5. After **each** direction:
   `docker exec misconception_db psql -U postgres -d misconception_system -tAc "SELECT proname, pronargs FROM pg_proc WHERE proname = 'sp_record_llm_analysis' ORDER BY pronargs;"`
6. Confirm `knowledge_chunks.embedding` is still `vector(1536)` and `idx_knowledge_chunks_vector_hnsw` still exists.

## Finish

Commit exactly:

```
feat(api): migration 0023 grounding columns and sp_record_llm_analysis v3
```

Report back: files changed, raw verification output, commit hash. **Do not start R2.**