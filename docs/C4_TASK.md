# C4 TASK — reading material: table, async queue, drain, invalidation hooks

You are implementing **PHASE C4 ONLY**. Authoritative spec: `docs/COSINE_READING_MATERIAL_BRIEF.md`
(**revision 3**) — read §1, §1b, §5, §10, §11.7–11.8 first. Decision record:
`../Context/Answer_Cosine_Plan.md` (D6, D7, D8, D11, D13, D18 — outside the repo).

Implement C4 and **nothing** from later phases: no metrics changes, no UI, no flag **endpoint**, no
student surface.

## The three rules that define this phase

1. **The analysis path must NOT call the LLM for generation.** It only inserts a cheap `PENDING` row.
   Reason: `analyze_submissions.py:13` marks anything left in `ANALYZING` past **10 minutes** as
   `ANALYSIS_FAILED`, so a long generation completion inside the analysis path could get a **live**
   submission double-claimed.
2. **No material for `SC`.** `INTERVENTIONS['SC']` already says no remediation. Enforced in the schema.
3. **Every failure is non-fatal.** A generation failure must never fail an analysis.

## Deliverables

### 1. Migration `0027_generated_reading_materials.py`

Highest existing is `0025`. Hand-written reversible `RunSQL`:

```sql
CREATE TABLE generated_reading_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_version_id UUID NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
    category VARCHAR(10) NOT NULL CHECK (category IN ('LK','FP','FN','MSC')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','READY','STALE','FAILED')),
    content_md TEXT,
    sources_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    grounded BOOLEAN NOT NULL DEFAULT FALSE,
    ungrounded_source_count INT NOT NULL DEFAULT 0,
    input_fingerprint CHAR(64),
    error TEXT,
    attempts INT NOT NULL DEFAULT 0,
    review_status VARCHAR(20) NOT NULL DEFAULT 'UNREVIEWED'
        CHECK (review_status IN ('UNREVIEWED','OK','FLAGGED')),
    flag_note TEXT,
    flagged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    flagged_at TIMESTAMPTZ,
    model_identifier VARCHAR(100),
    prompt_version VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (question_version_id, category)
);

CREATE INDEX IF NOT EXISTS idx_grm_drain
    ON generated_reading_materials (status) WHERE status IN ('PENDING','STALE');
```

**No `misconception_id`** (D12). Plain `UNIQUE (question_version_id, category)` is correct and is safe
for `ON CONFLICT ... DO NOTHING`. `content_md` is nullable because a `PENDING` row has no content.
Reverse drops the index and the table.

### 2. `backend/api/models.py` — `GeneratedReadingMaterial`

Read-model, `managed = False`, `db_table = 'generated_reading_materials'`. Match the DDL above.

### 3. `backend/api/reading_materials.py` — generation + queue helpers

- `input_fingerprint(prompt_version, model_identifier, question_version_id, category, prompt, ref_short, ref_reason) -> str`
  — sha256, 64-char lowercase hex.
- `enqueue_reading_material(question_version_id, category)` — `INSERT ... ON CONFLICT
  (question_version_id, category) DO NOTHING` with `status='PENDING'`. **No LLM call.** Returns whether a
  row was created. **Skip entirely when `category == 'SC'`.**
- `generate_reading_material(ctx, category)` — the real work:
  - Retrieves chunks exactly as R3 does (`retrieve_reference_chunks`).
  - Prompt: use **only** the supplied chunks for factual claims. `temperature =
    settings.READING_MATERIAL_TEMPERATURE` (0.0 — **not** the pipeline's 0.1).
  - Output JSON: `{"reading_material_md": "...", "sources": [{"chunk_id","document_id","document_title","page"}]}`.
  - `sources[]` is filtered to chunk ids **actually in the retrieved set**; the residue counts into
    `ungrounded_source_count`. This is the only detector standing in for the human backstop that D7
    removes.
  - Zero retrieved chunks → still generate, `grounded = False`, `sources = []` (D8).
  - On success: `status='READY'`, `content_md`, `sources_json`, `grounded`, `ungrounded_source_count`,
    `input_fingerprint`, `model_identifier`, `prompt_version='reading-material-v1.0'`, `attempts += 1`.
  - On failure: `status='FAILED'`, `error`, `attempts += 1` — **never raise into the caller.**
- `mark_stale_for_subject(subject_id)` / `mark_stale_for_question_version(qv_id)` — used by the hooks.

### 4. `backend/api/management/commands/drain_reading_materials.py`

One command, per D18. Flags: `--pending` (default), `--loop`, `--refresh`, `--replace`,
`--question-version <uuid>`, `--limit N`.

**Each tick runs the C2 sync first, then a batch of material.** Import
`sync_reference_embeddings` from `api.management.commands.sync_reference_embeddings` and call its
module-level function — do not shell out. `--loop` uses a short sleep between ticks
(`analyze_submissions` uses `POLL_INTERVAL_SECONDS = 5`).

- Work set: rows with `status IN ('PENDING','STALE')`.
- `--refresh`: recompute each `READY` row's `input_fingerprint`; if it differs, set `STALE` and regenerate.
- `--replace`: force regeneration regardless of fingerprint.
- Respect `settings.READING_MATERIAL_MAX_RUNS`: once `attempts >= MAX_RUNS`, stop retrying that row and
  leave it `FAILED` (log it). This caps the flag → regenerate loop (C6).

### 5. Invalidation hooks (D13 — C4's half)

- `post_save` on `QuestionVersion` and on `ReferenceAnswer` → mark the affected **material** rows
  `STALE`. Connect them in `backend/api/apps.py`'s `ready()` (or a small `signals.py` imported there).
  These models are `managed = False`; `post_save` still fires for ORM writes. **It does not fire for
  raw-SQL writes** — that is what `--refresh` is for.
- `ingest_materials` completion → mark the affected subject's material rows `STALE` (the corpus changed).
- Do **not** try to invalidate reference **embeddings** from signals — C2's `answer_hash` sweep already
  covers that and is cheaper.

### 6. Wire the queue into the analysis path

At the end of `analyze_submission`, **after** `category` is known, call `enqueue_reading_material(...)`
only when `category != 'SC'`. Wrap it so a queue failure is non-fatal. **No LLM call here.**

## Live facts

- Migration `0026` is applied; highest is `0025`. Your new one is `0027` (0025 is the merge migration,
  0026 the C1 columns).
- `retrieve_reference_chunks` / `build_reference_block` already exist in `llm.py` (R3). Reuse them; do not
  re-implement retrieval.
- `knowledge_chunks` has 330 embedded rows across 3 documents, so retrieval returns real passages.
- `subjects` / `question_versions`: 3 question versions. `category != 'SC'` means at most **4 rows per
  question version**.
- The active model comes from `get_active_model_identifier()` (`llm.py`), currently
  `openai/gpt-oss-20b`. Use it for `model_identifier`.
- Dev DB is the **evidence base**: do **not** create submissions, analyses, questions, subjects or users.

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- The analysis path must make **zero** generation LLM calls.
- Generation/retrieval failure is **always non-fatal**.
- Do not touch `MATRIX_RULES`, `evaluate_decision_matrix`, `student_feedback`, `grounding_*`,
  `validation_views.py`, `settings.py`, or the C2 command's logic.
- Keep the existing **48** tests green.

## Environment

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

Interpreter `backend/venv/Scripts/python.exe`. DB: docker `misconception_db`, `127.0.0.1:5433`,
`misconception_system`, user `postgres`. Docker Desktop is often off — start it, then the container.

## Verification — run all of these and paste the RAW output

1. `manage.py check`
2. `manage.py test api.tests_reference_materials` — 48 existing + your new tests, all green.
3. Migration forward → reverse → forward. After **each** direction show:
   `SELECT to_regclass('public.generated_reading_materials')`, the row count, and whether
   `idx_grm_drain` exists.
4. **Queue is LLM-free** — a mocked-pipeline test asserting `analyze_submission` inserts a `PENDING` row
   for a non-`SC` category and makes **no** generation call; and that an `SC` category inserts **no row**.
5. **One real end-to-end drain** for a single question version:
   `manage.py drain_reading_materials --limit 1 --refresh`
   Show the row(s) it produced: `status`, `grounded`, `sources_json` length, `ungrounded_source_count`,
   `input_fingerprint` length, `prompt_version`, `attempts`. This is **fixture data** — say so in your
   report and do not present it as course-quality content.
6. **Cache reuse** — run the drain again for the same question version and show that **no new
   generation happened** (no new row, `attempts` unchanged, content byte-identical).
7. **Zero-chunk path** — with mocked retrieval returning `[]`, generation still reaches `READY` with
   `grounded = false` and `sources = []`.
8. **Failure path** — with the LLM mocked to raise, the row becomes `FAILED` with `error` and
   `attempts = 1`, the analysis still reaches `PENDING_VALIDATION`, and repeated attempts stop at
   `READING_MATERIAL_MAX_RUNS`.
9. **Staleness hook** — inside a transaction you roll back, save a `QuestionVersion` through the ORM and
   show its material row went `STALE`. Show the rollback and confirm the status afterwards is unchanged.
10. Evidence base intact: `llm_analyses=8`, `PENDING_VALIDATION=2`, `VALIDATED=4`, `questions=3`.
11. `py_compile` on every edited backend file.

## Finish

Commit exactly:

```
feat(api): generated_reading_materials table, async queue, drain and invalidation hooks
```

Report back: files changed, raw verification output, commit hash, fixture rows created, and anything you
could not verify. **Do not start C5.**
