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
- **Next: R2** — task file ready at `docs/R2_TASK.md` (embeddings module + `ingest_materials`, per brief §6–§7).

## R2 dispatch (ready)

```bash
cd "D:/ClinicalAI_Misconception/Code/AI_Clinical_Missconceptopn" && \
  env -u PWD -u OLDPWD \
  "C:/Users/Pongo/AppData/Local/Programs/@opencodedesktop/resources/opencode-cli.exe" \
  run --standalone --auto --model alibaba-token-plan/qwen3.8-max \
  "Read docs/R2_TASK.md in this repository and execute it exactly."
```

R2 scope for the child: `backend/api/embeddings.py` + `backend/api/management/commands/ingest_materials.py`
ONLY. Reference run = the Sears PDF (462 pp → ~300 chunks, ~$0.005). Verify its claims yourself per §12; the
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