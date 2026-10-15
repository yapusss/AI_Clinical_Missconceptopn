# R5 TASK — materials API (upload / list / delete) + grounding metrics without validations

You are implementing **PHASE R5 ONLY** of the reference-materials feature, **backend only**.
Authoritative spec: `docs/REFERENCE_MATERIALS_IMPLEMENTATION_BRIEF.md` (§3 file list, §10.3, §13 must-not-do) and
`Context/Reference_Materials_Plan.md` (§9b #10, §10). Decisions taken with the owner 2026-10-12 are in this file.

**R5 = `backend/api/materials_views.py` (new) + `backend/api/urls.py` + one behaviour fix in
`backend/api/validation_views.py` + `--pending` in `backend/api/management/commands/ingest_materials.py` +
tests in `backend/api/tests_reference_materials.py`.**
**NO frontend file is touched in R5** — the three pages are R6 (see `docs/HANDOFF.md`).

## State you must trust (already verified, do not redo)

- R4 commit `c5b8910`: `ValidationDetailView` exposes `concept_breakdown_json`, `references`,
  `what_should_be_learned`, `grounding_similarity`, `grounding_payload`, `suggested_materials`;
  `_grounding_metrics` exists; `by_model` rows carry mean/coverage/validity/hallucinated. Leave that
  contract alone except where item 1 says otherwise.
- R3: `llm.py` writes the four grounding columns with `prompt_version = 'four-tier-v2.9-rag'`.
  KB now holds **1 document / 329 chunks** (Sears textbook, Physics `cfc7f58c-eeb8-451e-95e7-14c721e9574b`).
- Dev DB state: 4 current analyses — **Physics 3 (2 grounded), Biology 1 (0 grounded)** — 4 validations
  (3 `ACCEPTED` + 1 `EDITED`, all on Physics analyses). So **every analysis currently has a validation**;
  discriminating the denominator change needs one analysis without a validation (verification item 6).
- `materials_views.py` does NOT exist. `api/urls.py` has no materials route (only `uploads` :61,
  `metrics/model` :109).
- `knowledge_documents` columns: `id, subject_id, topic_id, uploaded_by, title, file_path, mime_type,
  raw_text, created_at, ingest_status (default PENDING), ingest_error, chunk_count`.
  `knowledge_chunks.document_id` FK is **ON DELETE CASCADE**; `subject_id` is RESTRICT; `topic_id` SET NULL.
- `MEDIA_ROOT = backend/media` (`settings.py:141-142`, gitignored). The directory does not exist yet.
- `MAX_UPLOAD_BYTES = 5MB` (`views.py:3828`) is the **image** cap used by `MediaUploadView` — do not touch it.
- `is_lecturer_for_subject(user, subject_id)` at `views.py:1043`; `_lecturer_subject_ids`/`_scope_filter`
  in `validation_views.py:39/47`.
- `LlmAnalysis` has `subject` (FK) and `is_current` (`models.py:372`).

## Deliverables

### 1. Grounding metrics must not require validations (first commit)

`ModelMetricsView.get` short-circuits at `validation_views.py:644`:
`if total == 0: return {total_validations: 0, by_model: [], message: …}` — so the 8 grounding keys are
invisible on any subject with zero validations, even when grounded analyses exist. Grounding is a property of
the analysis and needs no ground truth, so it is wrong for it to appear only after a lecturer validates.

Required behaviour:

- Grounding is computed over **all current analyses in the queried scope**, not over the analyses that happen
  to have validations. Scope = the same subject scope as validations (`_scope_filter`, superuser = all),
  narrowed by `?subject_id=` when present. Put the rationale in the docstring: a grounding number that only
  appears after a validation is useless as a pre-validation signal, and a number that *changes* when a
  validation appears is a bug.
- Add `_scope_analyses(user, subject_id)` returning `LlmAnalysis.objects.filter(<scope Q>, is_current=True)`
  (`subject_id=` applied when given) and feed `_grounding_metrics(list(...))` from it.
- Replace the merge at `:603` (`payload.update(_grounding_metrics([v.analysis for v in all_validations]))`)
  with the same all-analyses-in-scope source, so **both branches use one denominator**. Keep every key name
  and the 4dp rounding. `_compute_metrics` keeps its validation-derived payload only.
- `by_model`: the validation-derived fields stay as they are; the grounding keys of each row come from the
  analyses of that `model_identifier` **in scope** (not from its validations).
- The zero-validations branch must return `total_validations: 0`, `message`, **all 8 grounding keys**, and
  `by_model` containing one row per model present in scope with the validation-derived fields `None` and the
  grounding keys populated. It must also carry the same `note` text as the normal branch (`:681` — it already
  says grounding needs no lecturer validation and is BUKAN akurasi, so reuse it verbatim).
- Validation-derived keys (`scored_validations`, `rejection_rate`, `tier_agreement_accuracy`, `macro_f1`,
  `per_tier`, `confusion_matrix`, `percentage_mae`, `percentage_rmse`, `calibration`,
  `expected_calibration_error`) stay absent or `None` in the zero-validations branch — do not invent zeros.
- Do not rename a key, do not add accuracy wording anywhere.

### 2. `backend/api/materials_views.py` (new file)

Two APIViews in the repo's shape (`authentication_classes = [TokenAuthentication]`,
`permission_classes = [IsAuthenticated]`), lecturer-scoped: reuse `is_lecturer_for_subject`; superuser sees all.
All DB access is cursor SQL — these models are `managed=False` read-models, so **no ORM `save()`/`delete()`**.

- `MaterialListCreateView`
  - `GET /api/materials` (optional `?subject_id=`) → documents of the subjects the caller lectures:
    `id, subject_id, topic_id, title, mime_type, ingest_status, ingest_error, chunk_count, created_at,
    file_name` (basename only). Never return `raw_text` and never an absolute filesystem path.
    A `subject_id` the caller does not lecture → 403.
  - `POST /api/materials` (multipart) → fields `file` + `subject_id` (+ optional `topic_id`, `title`).
    Extension must be `.pdf`/`.md`/`.txt`; size cap **25 MB** with your own constant (e.g.
    `MATERIAL_UPLOAD_MAX_BYTES = 25 * 1024 * 1024`) — do not reuse or modify `MAX_UPLOAD_BYTES`.
    Save with `default_storage.save(f'materials/{uuid.uuid4().hex}{ext}', ContentFile(upload.read()))`
    (pattern at `views.py:3856`; confirm the parent dir is created), then INSERT the row by raw SQL in the
    shape of `ingest_materials._insert_document` (`:310`) with `ingest_status='PENDING'`, `file_path` = the
    saved relative path, `mime_type` from the upload, `uploaded_by = request.user`,
    `title` default = file stem. **No embedding call, no pymupdf work inside the request.** 201 with the row
    payload.
- `MaterialDetailView`
  - `DELETE /api/materials/<uuid:pk>` → lecturer for that document's subject only (403 otherwise, 404 unknown).
    `DELETE FROM knowledge_documents WHERE id = %s` — let the FK cascade remove the chunks, never delete
    `knowledge_chunks` rows by hand — then `default_storage.delete(file_path)`. 204. A `READY` document is
    deletable; that is the point of the endpoint.
- Do not register anything in admin; do not modify `MediaUploadView`.

### 3. `ingest_materials --pending` — drain the upload queue

- New flags: `--pending` (process every pending document once, oldest first) and `--loop`
  (implies `--pending`, repeats every `--interval` seconds, default 10). No Celery, no threads — it is a
  poller exactly like `analyze_submissions --loop`. Wire nothing into compose/systemd.
- Select `knowledge_documents WHERE ingest_status = 'PENDING' AND file_path IS NOT NULL ORDER BY created_at`.
  Reuse the command's existing helpers: `_read_pages:75` (dispatch on extension: pymupdf/md/txt),
  `_build_document:147`, `_chunk_text:175`, the embeddings client, `_insert_chunks:323`, `_mark_ready:345`,
  `_mark_failed:355`. The upload path leaves `raw_text` NULL, so the drain must UPDATE it too.
- **Per-document failure isolation**: catch the exception, `_mark_failed(doc_id, str(e))`, print it, and
  continue with the next document. A corrupt PDF must never kill the run or the loop. A `file_path` missing
  on disk → FAILED with a clear `ingest_error`, not a crash.
- Idempotent: a READY document is never picked up again; a second `--pending` run prints "nothing pending"
  and exits 0. `--dry-run` behaviour must stay byte-identical (zero network calls, embeddings client never
  constructed).

### 4. `api/urls.py`

Add next to the `uploads` route (`:61`):

```python
path('materials', MaterialListCreateView.as_view(), name='material-list-create'),
path('materials/<uuid:pk>', MaterialDetailView.as_view(), name='material-detail'),
```

### 5. Tests (`api/tests_reference_materials.py` — keep every existing test green)

DB-free `SimpleTestCase` only. **`manage.py test api` cannot run in this repo** — the domain tables are
unmanaged (V2 SQL), so the auto-created test DB has no `users` table and any `TestCase`/`TransactionTestCase`
class errors with `relation "users" does not exist`. Do not add one and do not try to "fix" `tests.py`.

Required new tests:

1. Upload validation helper: extension allow-list, the 25 MB cap, missing file.
2. Grounding with **zero validations**: the block is present, computed over the analyses in scope, with one
   analysis ungrounded (assert mean over the grounded ones, coverage, `no_grounding_count`).
3. `--pending` failure isolation: a document raising during extraction is marked FAILED and the next pending
   document is still processed (mock the file/embed helpers).
4. Materials scope helper: a subject the caller does not lecture is rejected.
5. Update the R4 test `GroundingMetricsTests.test_compute_metrics_merges_grounding_keys` to the new source
   (grounding no longer comes from the validations passed to `_compute_metrics`) — do not leave a stale
   assertion behind.

## Hard rules

1. Brief §13 verbatim: no `makemigrations`; no re-import of `V2_Full_Script.sql`; never re-embed chunks at
   analysis time; retrieval failure must never fail an analysis; never count invented citations; do not change
   `EMBEDDINGS_DIMENSIONS`; **do not reuse `MediaUploadView`** for PDFs; never present grounding similarity as
   accuracy; do not touch the student surface; do not commit secrets.
2. R5 is backend-only. Before you finish, `git diff --name-only HEAD | grep -E '^frontend/'` must print
   **nothing**.
3. Do not write to `validations` or `llm_analyses` rows — the item-1 change is read-only (the fresh analysis
   produced in verification item 6 comes from the normal pipeline, never from a hand INSERT).
4. Do not change the six detail keys R4 added, and do not change the shape of the validation-derived metrics.
5. Never delete `knowledge_chunks` rows directly; rely on the FK cascade.
6. No frontend type, page, sidebar or nav edit in this phase (R6 owns them).

## Environment

- DB `misconception_db` @ `127.0.0.1:5433`, db `misconception_system`, user `postgres`; query via
  `docker exec misconception_db psql -U postgres -d misconception_system -tAc "…"`.
- Env: `set -a && . ../../../scripts/env_local.sh && set +a` from `backend/` (the file lives outside the repo).
- Auth header is **`Authorization: Bearer <token>`** — `Token <token>` returns a deceptive 403 "Authentication
  credentials were not provided". Login: `POST /api/auth/login` with
  `{"email":"lecturer@acm.local","password":"demo12345"}`; NEVER print the token in the report.
- A backend on `:8000` may already be running with autoreload ON. **Do not kill it.** If the port is busy,
  start your own on `127.0.0.1:8001` and use that base URL.
- `pymupdf` is already installed in `backend/venv`. `backend/media/` is gitignored and missing — the upload
  endpoint must not fail when it does not exist yet.

## Verification — run all and paste the RAW output

1. `venv/Scripts/python.exe manage.py check`
2. `venv/Scripts/python.exe manage.py test api.tests_reference_materials -v 2` (all green)
3. Upload: small `.md` to Physics → paste the `curl -i` (201, `ingest_status: PENDING`); then
   `GET /api/materials?subject_id=cfc7f58c-eeb8-451e-95e7-14c721e9574b` with the row.
4. Drain: `venv/Scripts/python.exe manage.py ingest_materials --pending` → READY with `chunk_count > 0`;
   a second run prints "nothing pending". Paste
   `SELECT title, ingest_status, chunk_count, file_path FROM knowledge_documents;`
5. Failure isolation: upload a corrupt file named `*.pdf`, run `--pending` → that document is FAILED with
   `ingest_error`, and a second pending document still reaches READY in the same run.
6. **The denominator case R4 could not express**: create one fresh Physics submission through the real student
   endpoint and run one pass of `manage.py analyze_submissions` (no `--loop`), leaving that analysis with **no**
   validation. Then `GET /api/metrics/model` → the new analysis is inside the grounding denominator
   (`citation_coverage` denominator, `no_grounding_count`) while `total_validations` is unchanged at 4; and
   `GET /api/metrics/model?subject_id=68f1ccae-70b2-40a7-bddc-5ae457fa4d6a` (Biology, 0 validations) returns
   all 8 grounding keys. Paste both payloads. If a number moves versus R4 (pooled mean was 0.5465, coverage
   0.5, validity 1.0, `no_grounding_count` 2) state the old and the new value and why.
7. Delete: `curl -i -X DELETE /api/materials/<id>` → 204; then
   `SELECT count(*) FROM knowledge_chunks WHERE document_id = '<id>';` → 0, and the stored file is gone.

## Finish

Commit in this order:

```
fix(api): grounding metrics computed over all analyses in scope
feat(api): R5 materials upload/list/delete API and pending-ingest drain
```

Report back: files changed, raw verification output (tests + every curl + the SQL), `git log --oneline -3`,
and an explicit line confirming no frontend file was touched. **Do not start R6.**
