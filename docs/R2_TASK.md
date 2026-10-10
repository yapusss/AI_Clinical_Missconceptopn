# R2 TASK — embeddings module + `ingest_materials` command

You are implementing **PHASE R2 ONLY** of the reference-materials feature.
Authoritative spec: `docs/REFERENCE_MATERIALS_IMPLEMENTATION_BRIEF.md` (read it first — especially §6 and §7).
Implement R2 and **nothing** from later phases (no retrieval in `llm.py`, no prompt changes, no metrics, API or UI work).

R1 is already done and committed (`38fdf2c`): migration `0024` is applied — `llm_analyses` has the 4 grounding
columns, `knowledge_documents` has `ingest_status/ingest_error/chunk_count`, and `sp_record_llm_analysis` has
11-arg (legacy, dead) and 20-arg (v3) overloads. Settings (`EMBEDDINGS_*`, `RETRIEVAL_*`) exist in
`backend/config/settings.py` at lines 163–170. `pymupdf` + `openai>=1.50.0` are installed in `backend/venv`.
Do NOT redo any of that.

## Deliverables

1. **`backend/api/embeddings.py`** — exactly per brief §6:
   - `EmbeddingError(Exception)`
   - `get_embeddings_client() -> OpenAI` using `settings.EMBEDDINGS_BASE_URL/API_KEY`, timeout from
     `settings.LLM_TIMEOUT` (default 120.0).
   - `embed_texts(texts: list[str], batch_size: int = 64) -> list[list[float]]` — batched, retries with backoff,
     raises `EmbeddingError` on final failure, **validates every vector has length == `settings.EMBEDDINGS_DIMENSIONS`**.
   - `embed_text(text: str) -> list[float]`
   - `cosine(a, b) -> float` — clamped to [-1, 1]; 0.0 on zero-norm vector (no ZeroDivisionError).
   - `vector_literal(vec) -> str` — `'[0.1,0.2,...]'` text form for a `%s::vector` cast.
   - No grounding helper here — `grounded_similarity()` belongs in `llm.py` in a later phase.

2. **`backend/api/management/commands/ingest_materials.py`** — exactly per brief §7:
   ```
   python manage.py ingest_materials <path> --subject <uuid|slug> [--topic <uuid|slug>]
          [--title "..."] [--replace] [--dry-run] [--limit-pages A-B] [--batch-size 64]
   ```
   Stages:
   1. **Extract** — PDF via `import pymupdf; pymupdf.open(path)`, `page.get_text()`; `.md`/`.txt` as UTF-8.
      Keep 1-based `pages = [(page_no, text), ...]`. Light normalisation: collapse runs of 3+ spaces, drop
      page-number-only lines, strip the recurring running head.
   2. **Chunk** — target 800 tokens, 15% overlap. Token approximation = `len(text) / 4` — **document this
      approximation in the code**. Split preference: blank lines → sentence boundaries → hard split. Every chunk
      stores `metadata_json = {"page_start": int, "page_end": int, "char_start": int, "char_end": int}` and
      `token_count = round(len(content)/4)`.
   3. **Embed** — `embed_texts(...)` with `batch_size`; a failed batch is logged and reported, never dropped.
   4. **Store** — one `knowledge_documents` row (`subject_id`, `topic_id`, `uploaded_by`, `title`, `file_path`,
      `mime_type`, `raw_text`), then bulk-insert `knowledge_chunks` (`document_id`, `subject_id`, `topic_id`,
      `chunk_index`, `content`, `token_count`, `embedding`, `metadata_json`). Commit per batch. Set
      `ingest_status='READY'` + `chunk_count` at the end; on failure `'FAILED'` + `ingest_error`.
      Embedding written with `%s::vector` + `vector_literal(...)`.
   5. **`--replace`** — match existing doc by `(subject_id, title)` and delete it first (`knowledge_chunks` cascades).
   6. **`--dry-run`** — print document summary, chunk count, total approx tokens, estimated USD cost
      (`tokens/1e6 * 0.02`) and exit **without constructing the embeddings client at all** (zero network calls).

   Lifecycle rule: this command may use direct SQL/ORM inserts for the ingest tables (they are ingestion state,
   not the four-tier lifecycle); do not invent new stored procs.

## Reference run for verification

`D:/ClinicalAI_Misconception/References/Francis W. Sears, Gerhard L. Salinger-Thermodynamics, Kinetic Theory, and Statistical Thermodynamics-Addison Wesley (1975).pdf`
— 462 pages, ~917k chars, ~230k tokens → expect **~290–330 chunks**, ~**$0.005**.

The subject to ingest into: find the Physics subject row
(`docker exec misconception_db psql -U postgres -d misconception_system -tAc "SELECT subject_id, name FROM subjects ORDER BY name;"`).
If no Physics subject exists, report it and stop (do not create one silently).

## Hard rules

- **Never** run `makemigrations`.
- **Never** re-import `V2_Full_Script.sql`.
- Do not touch `EMBEDDINGS_DIMENSIONS` (1536 — the column is `vector(1536)`).
- `--dry-run` must make zero network calls.
- Do not touch `llm.py`, `validation_views.py`, urls, or any frontend file.
- Scoped to this repo only; secrets come only from the env, never hardcoded or committed.

## Environment

Before **every** `manage.py` call:

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

That file is **outside** this repo. Interpreter: `backend/venv/Scripts/python.exe` (run from `backend/`).
DB: docker container `misconception_db`, postgres at `127.0.0.1:5433`, db `misconception_system`, user `postgres`.
`psql` is not on PATH; use `docker exec misconception_db psql -U postgres -d misconception_system -tAc "..."`.

## Verification — run all of these and paste the RAW output

1. `venv/Scripts/python.exe manage.py check`
2. `venv/Scripts/python.exe manage.py ingest_materials "<sears pdf>" --subject <physics-uuid> --dry-run`
   → paste full output (pages / chunks / tokens / cost). No API call made.
3. `venv/Scripts/python.exe manage.py ingest_materials "<sears pdf>" --subject <physics-uuid> --title "Sears & Salinger — Thermodynamics" --replace`
4. `docker exec misconception_db psql -U postgres -d misconception_system -tAc "SELECT count(*), count(embedding) FROM knowledge_chunks WHERE document_id = '<doc-uuid>'; SELECT ingest_status, chunk_count FROM knowledge_documents WHERE document_id = '<doc-uuid>';"`
5. `manage.py shell` one-liner (or a throwaway script in the scratch dir, NOT committed): embed the query
   `"second law of thermodynamics"` with `embed_text`, then
   `SELECT * FROM fn_search_knowledge_chunks('<physics-uuid>', '%s'::vector, NULL, 5, 0.2);`
   → paste the top passage snippets showing sensible thermodynamics content.
6. Re-run step 3 with `--replace` and confirm the chunk count did not double.

## Finish

Commit exactly:

```
feat(api): embeddings module and ingest_materials command
```

Report back: files changed, raw verification output (dry-run numbers, real chunk count, search results, replace
idempotency proof), commit hash. **Do not start R3.**
