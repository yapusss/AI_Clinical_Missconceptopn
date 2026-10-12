# HANDOFF — Reference Materials + Grounding Similarity

Read this first. It is the cheap entry point: everything else is on disk, so no transcript is needed.

## Where things are

| Path | What |
|---|---|
| `Code/AI_Clinical_Missconceptopn/docs/REFERENCE_MATERIALS_IMPLEMENTATION_BRIEF.md` | **Authoritative spec.** Phases R0–R5, exact DDL, prompt text, metric keys, must-not-do list. |
| `Code/AI_Clinical_Missconceptopn/docs/R1_TASK.md` | The R1 task file (pattern to copy for R2+). |
| `D:/ClinicalAI_Misconception/Context/Reference_Materials_Plan.md` | Rationale + the 10 locked decisions (outside the repo). |
| `D:/ClinicalAI_Misconception/scripts/env_local.sh` | `DB_*`, `LLM_*`, `EMBEDDINGS_*`. Outside the repo, gitignored. Secrets are fragment-assembled. |
| `D:/ClinicalAI_Misconception/r1_out.log` | Raw OpenCode output from R1. |

## State

- **R0 — done, verified.** pgvector `0.8.6`; dev DB migrated to `0023`; `pymupdf 1.28.2` in `backend/venv`; OpenRouter
  embeddings proven live (1536 dims, unit-norm, batched).
- **R1 — done, verified, committed `97dbac1`.** (HANDOFF previously cited `38fdf2c`: that is a pre-rebase duplicate,
  not an ancestor of `HEAD` — the branch was rebased on 2026-10-12, so any hash older than `97dbac1` is orphaned.) `0024_grounding_and_knowledge_ingest.py` + `KnowledgeDocument`/
  `KnowledgeChunk` read-models + `LlmAnalysis` grounding fields + `EMBEDDINGS_*`/`RETRIEVAL_*` settings + `pymupdf`.
  Proven by a forward → reverse → forward cycle (cols 0→7→0→7, proc arities 11/16→11/20), `vector(1536)` and the HNSW
  index untouched.
- **R2 — done, verified by independent audit (2026-10-11, commit `9d3a869`; the previously cited `7c50c2e` is a
  pre-rebase orphan).** `api/embeddings.py` +
  `manage.py ingest_materials` match the brief. Personally re-ran: dry-run = 462 pp → **329 chunks**,
  256,004 tokens, $0.0051, zero network calls; real ingest → `READY`, 329/329 rows with non-null embeddings;
  `fn_search_knowledge_chunks("second law of thermodynamics")` returns on-topic entropy/Clausius passages
  (pp. 133–157); `cosine()` handles identical/orthogonal/zero vectors; chunk-count stayed 329 after a
  second `--replace` pass (no doubling).
- **R3 — done, verified by independent audit (2026-10-11, commit `1ed318c`; the previously cited `d6f99e2` is a
  pre-rebase orphan).** `llm.py` diff matches brief §8.1–8.6
  (context fields, non-fatal retrieval via `fn_search_knowledge_chunks` + second query for embeddings/titles,
  Modul B/C citation rules + zero-chunk prompts byte-identical, `validate_citations`, 1 advisory embedding call,
  21-placeholder CALL with typed casts, PROMPT version `four-tier-v2.9-rag`). Personally verified: 15/15 tests
  green; real Physics submission re-analysed → grounding 0.5679/0.5769, 2 valid citations (entropy passages
  pp. 133/142), populated `what_should_be_learned`; no-materials subject with DEAD `EMBEDDINGS_BASE_URL` still
  reached `PENDING_VALIDATION` with NULL grounding + `[]` materials (outage + zero-chunk regression in one).
- **R4 — done, verified by independent audit (2026-10-12, commit `c5b8910`).** `_grounding_metrics()` +
  merge into `_compute_metrics` (`validation_views.py:418`, `:569`), grounding keys on every `by_model` row,
  `_grounding_detail` exposure incl. the `concept_breakdown_json` UI-bug fix. Personally re-ran: `manage.py check`
  clean; **21/21** tests green; `GET /api/metrics/model` returns all 8 top-level keys — mean **0.5465**,
  coverage **0.5**, validity **1.0**, `no_grounding_count` **2** — reconciling with raw SQL (`docker exec psql`;
  4 current analyses, 2 grounded); `GET /api/validations/{id}` exposes all 6 keys on all 4 analyses with
  `len(references) == grounding_citation_count` and payloads matching the DB row-for-row; the 21-slot
  `sp_record_llm_analysis` call and `prompt_version = four-tier-v2.9-rag` unchanged. 4 validations
  (3 `ACCEPTED` + 1 `EDITED`) were created during the phase so the metrics block is non-empty — they are audit
  fixtures, not lecturer data. Reusable harness: `D:/ClinicalAI_Misconception/scripts/r4_audit.py` (read-only,
  recomputes every grounding metric from the DB and diffs it against the live API; rerun it after R5).
- **R5 — done, audited by independent audit (2026-10-12, commits `d5dec9e` + `2594938`).** `materials_views.py`
  (upload/list/delete, lecturer-scoped), `api/urls.py` routes, `ingest_materials --pending`/`--loop` drain,
  grounding computed over **all analyses in scope** (supersedes R4's source). Personally reproduced: 31/31 tests
  green; upload → `PENDING` → one `--pending` pass → corrupt `.pdf` `FAILED` with `ingest_error` **and** good `.md`
  `READY` with chunks in the same run; delete `204` + chunks cascaded + file gone; `?subject_id=<Chemistry>`
  (0 validations) returns all 8 grounding keys; denominator triangulation now matches *all analyses in scope*
  (4 analyses-of-validations no longer reconcile, 6 analyses-in-scope do). Findings: **F1 (fix in R5F)** `?model=`
  no longer restricts the grounding block — `?model=openai/does-not-exist` returned pooled `0.6517 / coverage 0.5`
  and a `by_model` row for a model that is not the filter, contradicting its own docstring; F2 `POST /api/materials`
  accepts a cross-subject `topic_id` (Physics doc accepted a Biology topic → corpus row unreachable to
  topic-narrowed retrieval); F3 `by_model` row-set asymmetry between the two branches (unobservable while one
  model identifier exists); F5 `.markdown` in the allow-list; F6 orphan chunks if a run dies mid-insert.
- **R5F — done, verified by independent audit (2026-10-12, commit `f6db059`).** `_scope_analyses(user, subject_id,
  model_filter)` now narrows the query, and the pure `_filter_analyses_by_model()` post-condition enforces the same
  invariant on the materialised list used by **both** branches (`:739`, `:744`); `_by_model_row` grounding still comes
  from that filtered list (`:758`). Personally verified: 34/34 tests green (3 new `ModelFilterTests`, including the
  zero-analyses shape); `?model=openai/does-not-exist` → `mean/median/coverage/validity/hallucinated` all `null`,
  buckets `{}`, `no_grounding_count 0`, `by_model []` (was `0.6517 / coverage 0.5 / no_grounding 3` + a
  foreign `by_model` row); the same for `?subject_id=<Chemistry>&model=<bogus>` (was `coverage 0.0`,
  `no_grounding 1`, foreign row); `?model=openai/gpt-oss-20b` differs from the unfiltered payload **only** by the
  echoed `model_filter`; unfiltered unchanged (`total_validations 4`, mean `0.6517`, coverage `0.5`,
  `no_grounding_count 3`); Physics scope unchanged (`3 / 0.6517 / 0.75 / 1`); PDF-anchored block unchanged
  (mean = median `0.5465`, coverage `1.0`, validity `1.0`); no new data row, no frontend file.
- **Next: R6 (task file ready at `docs/R6_TASK.md`)** — lecturer surfaces: `frontend/app/materials/page.tsx` (upload/list/
  delete), `frontend/app/metrics/page.tsx`, citations + learning list on `validation/[id]`, shared types in
  `app/lib/studentSubmissions.ts`, sidebar entries — plus **one backend addition decided 2026-10-12**: `_grounding_detail`
  must put `document_title` on every citation reference (brief §10.2 asks for the title; the payload only carried
  `document_id`, and the page must not join against `/api/materials` to get it). Verified by a prod build on `:3002`
  + headless-Edge CDP pass (stop the `:3001` dev server first). Known, deliberately unfixed leftovers from the R5
  audit: F2 cross-subject `topic_id` accepted on upload (the UI picker simply must not offer foreign topics),
  F3 `by_model` row set comes from the validations in the non-empty branch, F5 `.markdown` allow-listed, F6 no retry
  for a `FAILED` document that already inserted chunks. **Then R7 = gated student surface.** The 2026-10-08 build
  order called the UI "R5" — phases were renumbered 2026-10-12 when the materials API was split out (plan §10).

## R6 dispatch (ready)

```bash
cd "D:/ClinicalAI_Misconception/Code/AI_Clinical_Missconceptopn" && \
  env -u PWD -u OLDPWD \
  "C:/Users/Pongo/AppData/Local/Programs/@opencodedesktop/resources/opencode-cli.exe" \
  run --standalone --auto --model alibaba-token-plan/qwen3.8-max \
  "Read docs/R6_TASK.md in this repository and execute it exactly."
```

Run it with `background=true, notify=true, persist_on_release=true`. Verify after it reports:
(a) `document_title` on every citation of the PDF-anchored detail payload, `null` for a malformed entry;
(b) `npm run build` clean and `/materials` + `/metrics` present in the route list, served from `:3002`;
(c) the CDP pass — /materials upload → PENDING → drain → READY → delete (document count back to 3), /metrics with the
zero-validations state for Chemistry and no "akurasi" next to the grounding score, citations + learning list render on
the PDF-anchored analysis and the empty state on an ungrounded one, confirm/deny list still populates;
(d) 34 backend tests plus the new ones green; (e) only the seven allowed files changed.
The owner's audit harness is `D:/ClinicalAI_Misconception/scripts/r4_audit.py` (API/DB side) plus
`r6_ui_audit.py` (CDP side) — run both.

## R5F dispatch (done — commit `f6db059`, audited 2026-10-12)

```bash
cd "D:/ClinicalAI_Misconception/Code/AI_Clinical_Missconceptopn" && \
  env -u PWD -u OLDPWD \
  "C:/Users/Pongo/AppData/Local/Programs/@opencodedesktop/resources/opencode-cli.exe" \
  run --standalone --auto --model alibaba-token-plan/qwen3.8-max \
  "Read docs/R5F_TASK.md in this repository and execute it exactly."
```

Run it with `background=true, notify=true, persist_on_release=true`. Scope for the child:
`backend/api/validation_views.py` (make `_scope_analyses` model-aware, pass `model_filter` from both call sites)
+ `backend/api/tests_reference_materials.py` (DB-free filter test). Verify after it reports:
(a) `?model=openai/does-not-exist` returns the zero-analyses shape (all grounding values `null`, buckets `{}`,
`by_model []`) instead of pooled `0.6517 / coverage 0.5`; (b) `?model=openai/gpt-oss-20b` is identical to the
unfiltered payload; (c) the unfiltered payload still reads `total_validations 4`, mean `0.6517`, coverage `0.5`,
`no_grounding_count 3`; (d) the PDF-anchored block over `8a0f0dc2…` + `1c1d7bf2…` still reads mean = median
`0.5465`, coverage `1.0`, validity `1.0`; (e) no new data row, no frontend file, 31 existing tests still green.

## R5 dispatch (done — commits `d5dec9e` + `2594938`, audited 2026-10-12, fix in R5F)

```bash
cd "D:/ClinicalAI_Misconception/Code/AI_Clinical_Missconceptopn" && \
  env -u PWD -u OLDPWD \
  "C:/Users/Pongo/AppData/Local/Programs/@opencodedesktop/resources/opencode-cli.exe" \
  run --standalone --auto --model alibaba-token-plan/qwen3.8-max \
  "Read docs/R5_TASK.md in this repository and execute it exactly."
```

Run it with `background=true, notify=true, persist_on_release=true`. R5 scope for the child:
`backend/api/materials_views.py` (new), `backend/api/urls.py`, one behaviour fix in
`backend/api/validation_views.py` (grounding over all analyses in scope — first commit), `--pending` in
`backend/api/management/commands/ingest_materials.py`, tests in `backend/api/tests_reference_materials.py`.
Verify after it reports: (a) `git diff --name-only` shows no `frontend/` file; (b) upload → `PENDING` row →
`--pending` → `READY` with chunks, and a corrupt PDF marks `FAILED` without killing the run; (c) delete removes
the chunks (FK cascade) and the stored file; (d) `/api/metrics/model` returns all 8 grounding keys on a subject
with **zero** validations, and the grounding denominator includes an analysis that has no validation;
(e) the six R4 detail keys and the validation-derived metric names are unchanged.

## R4 dispatch (done — commit `c5b8910`, audited 2026-10-12)

```bash
cd "D:/ClinicalAI_Misconception/Code/AI_Clinical_Missconceptopn" && \
  env -u PWD -u OLDPWD \
  "C:/Users/Pongo/AppData/Local/Programs/@opencodedesktop/resources/opencode-cli.exe" \
  run --standalone --auto --model alibaba-token-plan/qwen3.8-max \
  "Read docs/R4_TASK.md in this repository and execute it exactly."
```

R4 scope for the child: `backend/api/validation_views.py` + extending
`backend/api/tests_reference_materials.py` ONLY. Verify after it reports: (a) `_compute_metrics` grounding
keys exist and are None-safe for old v2.8 analyses; (b) `ValidationDetailView` returns `concept_breakdown_json`,
`references`, `what_should_be_learned`, `suggested_materials`, `grounding` (same shape for old analyses);
(c) `/api/metrics/model` shows grounding keys top-level AND per `by_model`; (d) the `note` still says metrics
need lecturer ground truth and grounding needs none, never calling grounding "accuracy".

## R3 dispatch (ready)

```bash
cd "D:/ClinicalAI_Misconception/Code/AI_Clinical_Missconceptopn" && \
  env -u PWD -u OLDPWD \
  "C:/Users/Pongo/AppData/Local/Programs/@opencodedesktop/resources/opencode-cli.exe" \
  run --standalone --auto --model alibaba-token-plan/qwen3.8-max \
  "Read docs/R3_TASK.md in this repository and execute it exactly."
```

R3 scope for the child: `backend/api/llm.py` + new `backend/api/tests_reference_materials.py` ONLY. key risks
to verify after it reports: (a) the CALL now has 21 placeholders and does NOT error with "procedure does not
exist"; (b) a real Physics submission yields non-null grounding_similarity + populated payload;
(c) a no-materials subject still analyses (regression); (d) an unreachable EMBEDDINGS_BASE_URL does NOT mark
the submission ANALYSIS_FAILED.

## R2 dispatch (ready)

```bash
cd "D:/ClinicalAI_Misconception/Code/AI_Clinical_Missconceptopn" && \
  env -u PWD -u OLDPWD \
  "C:/Users/Pongo/AppData/Local/Programs/@opencodedesktop/resources/opencode-cli.exe" \
  run --standalone --auto --model alibaba-token-plan/qwen3.8-max \
  "Read docs/R2_TASK.md in this repository and execute it exactly."
```

R2 scope for the child: ~~`backend/api/embeddings.py` + `backend/api/management/commands/ingest_materials.py`
ONLY~~ **DONE, commit `7c50c2e` — do not rerun.** Reference run = the Sears PDF → 329 chunks, $0.0051. Verify its claims yourself per §12; the
`--dry-run` must print chunk/token/cost numbers without any network call, and re-running with `--replace` must
not double the chunk count.

## Environment

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
cd Code/AI_Clinical_Missconceptopn/backend
venv/Scripts/python.exe manage.py <cmd>
```

Dev DB = docker container `misconception_db` (pgvector/pg16) → **host `:5433`**, db `misconception_system`, user `postgres`.
`psql` is not on PATH; use `docker exec misconception_db psql -U postgres -d misconception_system -tAc "..."`.

## Delegating a phase to OpenCode

Use the desktop CLI, never the npm one:

```bash
cd "D:/ClinicalAI_Misconception/Code/AI_Clinical_Missconceptopn" && \
  env -u PWD -u OLDPWD \
  "C:/Users/Pongo/AppData/Local/Programs/@opencodedesktop/resources/opencode-cli.exe" \
  run --standalone --auto --model alibaba-token-plan/qwen3.8-max \
  "Read docs/R2_TASK.md in this repository and execute it exactly."
```

Run it with `background=true, notify=true, persist_on_release=true`. `env -u PWD -u OLDPWD` is **required** — the
MSYS `$PWD` (`/d/...`) makes OpenCode's `chdir()` die. Put the full task in a `docs/Rn_TASK.md` file and pass only a
pointer, so the CLI arg cannot be mangled. Verify the child's claims yourself: it self-reports, and once it looped for
95 minutes on a no-op it had misread.

## Hard rules

1. Never `makemigrations`. 2. Never re-import `V2_Full_Script.sql`. 3. Lifecycle writes go through stored procs.
4. Retrieval failure must never fail an analysis. 5. Never present grounding similarity as accuracy.
6. Do not touch the student surface (out of scope until the whole lecturer side is done).

## Gotchas learned the hard way

- **`OUT` must precede defaulted params.** PostgreSQL: `procedure OUT parameters cannot appear after one with a default
  value`. Call shape is `(16 values, NULL, 4 grounding values)`.
- **Migration is `0024`.** `0023_exam_package_expiry_behavior` already exists on `main` — check `ls backend/api/migrations/`
  before numbering anything new.
- **Two `sp_record_llm_analysis` overloads exist** (11-arg legacy, 20-arg v3). Always `DROP` by exact argument types.
- The `:5435` PG18 harness has **pgvector stripped** — unusable for this feature. Use `:5433`.
- The OpenRouter key used in this build was pasted into a chat transcript: **rotate it**.
- **Auth header is `Bearer`, never `Token`.** `docs/R4_TASK.md` item 4 says `Authorization: Token <token>`; this
  app's `TokenAuthentication` rejects it with a **403 "Authentication credentials were not provided"** — which
  reads like a broken endpoint rather than a bad header. Use `Authorization: Bearer <token>`.
- **`docs/R4_TASK.md` items 4 and 6 are unreachable on this DB as written.** No `four-tier-v2.8` analysis exists
  anywhere (only `four-tier-v2.9-rag`), so an "old analysis regression curl" cannot be run at all — old-shape
  safety can only be proven by unit test (`GroundingDetailShapeTests.test_old_analysis_shape_is_stable`). Item 4
  needs validations to exist before the grounding keys can appear (see the `total == 0` short-circuit below).
  Any report claiming those two curls was not run.
- **`/api/metrics/model` short-circuits on `total_validations == 0`** (`validation_views.py:644`), returning only
  `{total_validations, by_model: [], message}` — so grounding is invisible on any subject with zero validations
  even when grounded analyses exist. R4 left this as-is (brief-faithful); it is open item §9b #10, to be lifted in
  R5 alongside the `/metrics` page.
- **The raw-count convention in `grounding_by_category`/`_by_prompt_version` is "grounded only"**: a bucket
  appears only if it has an analysis with a non-null similarity (so `count` is the N behind `similarity_mean`).
  Categories whose analyses are all ungrounded are absent rather than present-with-null — carry that into the
  `/metrics` page, and to `no_grounding_count` for the complement.
- **Two frontend dev servers on this 16 GB box will exhaust RAM.** The R6 browser pass wants a **prod** build on
  `:3002` (HMR/headless-Edge pitfall) — stop the `:3001` dev server first.
- **Port `3001` is not free: the Hermes messaging bridge owns `127.0.0.1:3001`** and answers unknown paths with an
  Express-style `Cannot GET /validation/…`. A `next dev -p 3001` started alongside it loses the address race, so
  requests silently hit the bridge and every UI assertion fails for the wrong reason (observed 2026-10-12: `/login`
  returned 17 chars and no `<form>`). Always drive the **prod build on `:3002`** (`BACKEND_URL=http://localhost:8000`),
  and before trusting any UI run, assert the target is really the app: `document.querySelector('form')` must exist on
  `/login` and the body must not contain `Cannot GET`. `D:/ClinicalAI_Misconception/scripts/r6_ui_audit.py` does that
  precheck and then polls for text (a cold start compiles a route on first hit, so fixed settles give false failures).
- **`manage.py test api` cannot pass in this repo — use the per-module path.** The domain tables are unmanaged
  (V2 SQL), so the auto-created test DB has no `users` table and every `TestCase`/`TransactionTestCase` errors with
  `relation "users" does not exist`; `api/tests.py`'s DB-backed classes are in that state. Run
  `manage.py test api.tests_reference_materials` (DB-free `SimpleTestCase`) and prove endpoint behaviour by real
  HTTP against the live DB — which is this repo's hard rule anyway. Do not add a `TestCase` and do not "fix"
  `tests.py` as part of a feature phase.
- **Materials upload is staged, not inline.** `POST /api/materials` only saves the file and inserts a `PENDING`
  `knowledge_documents` row; `manage.py ingest_materials --pending` (a poller, like `analyze_submissions --loop`)
  does extract → chunk → embed → READY. Nothing embeds inside a web request, and a corrupt document is marked
  `FAILED` with `ingest_error` without killing the run.
- **An upload is not usable until it is drained, and nothing drains it automatically.** The file goes to
  `MEDIA_ROOT/materials/<uuid4().hex><ext>` (`backend/media/`, **gitignored**), the row is `PENDING` with
  `raw_text NULL` and `chunk_count NULL`, so there are **no `knowledge_chunks` rows** and analysis-time retrieval
  cannot see the document at all. No compose service, cron or systemd unit references `ingest_materials` — the
  only trigger is a human running `--pending` / `--loop`. Consequences for any deployment: `MEDIA_ROOT` must be a
  mounted volume (rows without files drain into `FAILED: file not found`), and the Sears row's `file_path` is an
  **absolute Windows path** from the R2 CLI ingest, so it is not portable. Open items plan §9b #11–#12; the upload
  endpoint also saves the file before inserting the row, with no cleanup if the INSERT fails.
- **The dev DB contains audit fixtures that are NOT real course data — and `grounding_similarity` alone cannot tell
  them apart.** Created during R4/R5 verification (2026-10-12): the Chemistry subject
  `0b000000-0000-0000-0000-000000000030` (+ its set/question/submission/role grants), the ad-hoc `.md` upload
  `r5_sample2` (`knowledge_documents.id = 8e0d21ac-b698-44fa-9241-6a77c3d21f30`, 1 chunk), and
  the analysis `eda8f335-d4af-406a-9b54-fba77f84bbcf` whose **0.8620** similarity comes from citing `r5_sample2`,
  not the textbook. 4 of the 4 `validations` rows are also audit fixtures (see R4 above). Consequence: "mean
  grounding 0.6517 over 6 analyses" is *not* a course-quality number. When asserting on grounding, filter to
  **PDF-anchored** analyses (references resolving into the `Sears%` document): today only `8a0f0dc2…` 0.5252 and
  `1c1d7bf2…` 0.5679 → mean = median 0.5465. A `grounding_similarity` value alone proves nothing about the source.