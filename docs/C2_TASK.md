# C2 TASK — `sync_reference_embeddings`: the change-detecting reference-answer embedding cache

You are implementing **PHASE C2 ONLY** of the answer-cosine / reading-material change.
Authoritative spec: `docs/COSINE_READING_MATERIAL_BRIEF.md` — **revision 3, 2026-10-14** — read §1, §1b,
§3, §10, §11 first. Decision record: `../Context/Answer_Cosine_Plan.md` (D2, D13, outside the repo).
Implement C2 and **nothing** from later phases (no similarity computation, no thresholds, no generation,
no UI, no `post_save` signals).

**This is a change-detecting SYNC, not a one-time backfill.** A second run with nothing edited must
embed **zero** rows. That is the acceptance criterion, not a nicety.

## Deliverables

1. **`backend/api/management/commands/sync_reference_embeddings.py`** — new command.

   Put the core logic in a **module-level function** (not only inside `Command.handle`) so the C4 drain
   can import and call it without shelling out. Suggested shape:
   `def sync_reference_embeddings(*, dry_run=False, limit=None, question_version_id=None, log=...) -> dict`
   returning counts.

   For **every** question version (or just `--question-version <id>` when given):

   **(a) Reconcile the mirror first.** Every question version must have exactly two `reference_answers`
   rows, matching `views.py:66 _sync_reference_answers` exactly:

   | `answer_key` | `answer_type` | `is_primary` | `answer_text` source |
   |---|---|---|---|
   | `JAWABAN_SINGKAT` | `CANONICAL` | `true` | `question_versions.short_answer` |
   | `ALASAN` | `REASON` | `false` | `question_versions.model_answer` |

   Import `_sync_reference_answers` if it imports cleanly into a management command; otherwise port the
   two-row logic locally. Either way the two rows must be **semantically identical** to `views.py:66`
   (same keys, same types, same `is_primary`). Report `created` / `already present` **separately** from
   the embed counts. The live dev DB has only 2 mirror rows for 1 of 3 question versions — this step
   must fix that.

   **(b) Compute the effective text and its hash, per row.** One `embedding` column per row gives C3
   both vectors it needs — that is why the cache lives on `reference_answers` and not on
   `question_versions`:

   | row | effective text (same resolution `load_context` applies, `llm.py:248-249`) |
   |---|---|
   | `JAWABAN_SINGKAT` | `question_versions.short_answer` if non-empty, else `model_answer`, else this row's `answer_text` |
   | `ALASAN` | `question_versions.model_answer` if non-empty, else this row's `answer_text` |

   `answer_hash` = `hashlib.sha256(effective_text.encode('utf-8')).hexdigest()` — a 64-char lowercase
   hex string, matching the `CHAR(64)` column.

   **(c) Embed only what changed.** Embed a row's effective text **iff** `answer_hash` is NULL, or
   differs from the stored value, or `embedding` is NULL. Otherwise skip it entirely — no network call.
   Store both `answer_hash` and `embedding` on that row.

   Use `api/embeddings.py:embed_texts` (batched, order-preserving, retry+backoff, dimension-validated).
   Write `answer_hash` **even when the embedding is skipped**, so a first run on an already-embedded row
   still records the hash.

2. **Flags** (mirror the `ingest_materials` conventions):

   | flag | behaviour |
   |---|---|
   | `--dry-run` | report the plan: per-question-version reconcile counts, rows to embed, a rough token estimate (chars/4). **Zero network calls. Zero writes.** |
   | `--refresh` | the normal sweep — walk everything, embed only what changed |
   | `--limit N` | cap the number of question versions processed |
   | `--question-version <uuid>` | restrict to one question version |

   Default (no flags) = `--refresh`. Print a summary line with the counts.

3. **Nothing else.** No signals. No changes to `llm.py`, `views.py`, `models.py`, `settings.py`,
   `validation_views.py`, `embeddings.py`, or any migration. C1 already created the columns.

## Live facts you must respect

- Migration `0026` is applied: `reference_answers` has `embedding vector(1536)` and `answer_hash CHAR(64)`.
  Highest migration is `0025`. **Do not create a migration.**
- The dev DB is the **evidence base, not a test DB.** C2 writes to `reference_answers.embedding` /
  `answer_hash` — that is its job and is expected. But do **not** create submissions, analyses, questions,
  subjects or users, and do **not** edit any `question_versions` text to "make change detection work".
  If you need to prove change detection, do it inside a transaction you roll back.
- `question_versions.short_answer` is **nullable**; `model_answer` is `NOT NULL`.
- The mirror is currently incomplete: **2 rows for 1 of 3 question versions**, while all 3 have non-empty
  `short_answer` and `model_answer`. Reconcile must produce **6 rows** (3 versions × 2).
- Embeddings come from OpenRouter via `EMBEDDINGS_BASE_URL` / `EMBEDDINGS_MODEL` /
  `EMBEDDINGS_DIMENSIONS=1536`. `api/embeddings.py` already validates every vector's length.
- Cost is tiny: one vector per reference row, and zero when nothing changed.

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- Do not touch `knowledge_chunks.embedding` or `idx_knowledge_chunks_vector_hnsw`.
- Do not add an index to `reference_answers.embedding`.
- Do not change the two-row mirror semantics from `views.py:66`.
- The command must be safe to run repeatedly.

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
2. `venv/Scripts/python.exe manage.py test api.tests_reference_materials` — must stay **36 OK**.
3. **Dry-run makes zero network calls — prove it, don't assert it.** Point the provider at an
   unreachable host and confirm the dry run still reports its plan:
   ```bash
   EMBEDDINGS_BASE_URL='http://127.0.0.1:9/v1' venv/Scripts/python.exe manage.py sync_reference_embeddings --dry-run
   ```
   If it hangs or errors on connection, it made a call — that is a FAIL.
4. **Reconcile**: `reference_answers` goes from 2 rows to **6** (3 question versions × 2). Show the
   before/after counts and the `created` / `already present` split.
5. **First `--refresh`** — show how many rows were embedded. Then run it a **second** time with nothing
   edited and show it embedded **zero**. Paste both summaries.
6. **Coverage**: every reference row has a non-NULL `embedding` and a 64-char `answer_hash`:
   ```bash
   docker exec misconception_db psql -U postgres -d misconception_system -tAc "SELECT COUNT(*) AS total, COUNT(embedding) AS embedded, COUNT(answer_hash) AS hashed, MIN(length(answer_hash)) AS min_len FROM reference_answers;"
   ```
7. **Change detection** — inside a transaction you roll back, change one question version's `short_answer`,
   recompute, and show that **exactly one** row's hash differs and would be re-embedded. Show the SQL and
   the rollback, and confirm the counts afterwards are unchanged.
8. **Vector sanity** — one embedding has 1536 dimensions:
   ```bash
   docker exec misconception_db psql -U postgres -d misconception_system -tAc "SELECT vector_dims(embedding) FROM reference_answers WHERE embedding IS NOT NULL LIMIT 1;"
   ```
9. **Evidence base intact** — `llm_analyses` still 8, `submissions` still `PENDING_VALIDATION=2 /
   VALIDATED=4`, `questions` still 3.
10. `git diff --stat backend/api/llm.py backend/api/models.py backend/api/views.py backend/api/settings.py`
    → **empty** (settings is `backend/config/settings.py`; check both paths).

## Finish

Commit exactly:

```
feat(api): sync_reference_embeddings command with answer_hash change detection
```

Report back: files changed, raw verification output, commit hash. **Do not start C3.**
