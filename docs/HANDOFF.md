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
- **R1 — done, verified, committed `38fdf2c`.** `0024_grounding_and_knowledge_ingest.py` + `KnowledgeDocument`/
  `KnowledgeChunk` read-models + `LlmAnalysis` grounding fields + `EMBEDDINGS_*`/`RETRIEVAL_*` settings + `pymupdf`.
  Proven by a forward → reverse → forward cycle (cols 0→7→0→7, proc arities 11/16→11/20), `vector(1536)` and the HNSW
  index untouched.
- **R2 — done, verified by independent audit (2026-10-11, commit `7c50c2e`).** `api/embeddings.py` +
  `manage.py ingest_materials` match the brief. Personally re-ran: dry-run = 462 pp → **329 chunks**,
  256,004 tokens, $0.0051, zero network calls; real ingest → `READY`, 329/329 rows with non-null embeddings;
  `fn_search_knowledge_chunks("second law of thermodynamics")` returns on-topic entropy/Clausius passages
  (pp. 133–157); `cosine()` handles identical/orthogonal/zero vectors; chunk-count stayed 329 after a
  second `--replace` pass (no doubling).
- **R3 — done, verified by independent audit (2026-10-11, commit `d6f99e2`).** `llm.py` diff matches brief §8.1–8.6
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
- **Next: R5** — lecturer UI: `/materials` upload page + citation/learning-list rendering on `validation/[id]`,
  plus the adopted default "build a minimal `/metrics` page". Task file not yet written. **Carry in the R4 open
  item** (`Context/Reference_Materials_Plan.md` §9b #10): lift the grounding block above the `total == 0`
  early return so grounding is visible before any validation exists.

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
- **Two frontend dev servers on this 16 GB box will exhaust RAM.** The R5 browser pass wants a **prod** build on
  `:3002` (HMR/headless-Edge pitfall) — stop the `:3001` dev server first.