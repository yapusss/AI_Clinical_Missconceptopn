# Answer-Cosine + LLM-Generated Reading Material — Implementation Brief

Authoritative spec for phases **C0–C8**. Read with `Context/Answer_Cosine_Plan.md` (decisions
D1–D19, rationale, cost model).

**Revision 3 — 2026-10-14.** Adds the pre-dispatch review (D16–D19, see §4, §5, §6, §9) and settles the
deployment question (D15). **Revision 2** integrated seven operator inputs: default verdict source flipped to the
LLM with the rule in shadow, `misconception_id` deferred, generation made asynchronous, cache
invalidation added, a flag/regenerate path added, the C1 compatibility proof hardened, and C5 split
into expand-then-contract. **Two revision-1 claims are withdrawn — see §4 (cost) and §5
(`misconception_id`, `UNIQUE NULLS NOT DISTINCT`, `COALESCE` sentinel).**

Additive to `docs/REFERENCE_MATERIALS_IMPLEMENTATION_BRIEF.md`. Nothing in R1–R6 is deleted except the
metric keys named in §9, and only in C8.

Phase order is strict. Each phase ends with a commit and a report; do not start the next phase.

| Phase | Scope | Depends on | Deployable |
|-------|-------|------------|------------|
| **C0** | Baseline, DB up, branch safety net | — | — |
| **C1** | Migration `0026`: 7 columns, `sp_record_llm_analysis` v4 | C0 | backend, inert |
| **C2** | `sync_reference_embeddings` — change-detecting, **not** a one-shot | C1 | backend, inert |
| **C3** | Similarity + **shadow** rule verdict | C2 | backend, inert |
| **C4** | Reading material: table, async queue, drain | C3 | backend, inert |
| **C5** | Metrics — **additive only** | C4 | backend |
| **C6** | Lecturer surfaces + flag/regenerate | C5 | frontend |
| **C7** | Student surfaces | C6 | frontend |
| **C8** | Contract: remove the superseded keys | C6, **same release** | backend |

C1–C4 are behaviour-neutral and can ship independently. **C5, C6 and C8 are one release** — backend and
frontend are built and deployed together in a private architecture, so C8 is the *last commit of that
release*, verified after C6, not a later deployment (§9). The phase/commit granularity is kept: one
verifiable commit per phase.

---

## 1. Facts already verified in the tree (do not re-litigate)

- `MATRIX_RULES` (`backend/api/llm.py:52`) = 16 keys, the complete cartesian product. Distribution
  `LK:12, SC/FP/FN/MSC:1 each`. All 4 non-`LK` rows require `t2_yakin AND t4_yakin`.
- `llm.py:740` already collapses `BENAR_SEBAGIAN` → `'S'`. **No change (D4).**
- `reference_answers` is keyed `(question_version_id, answer_key)` with exactly two rows per version
  from `views.py:66 _sync_reference_answers`: `JAWABAN_SINGKAT`/`CANONICAL` and `ALASAN`/`REASON`.
  `load_context` **prefers** the `question_versions` columns and falls back to the mirror
  (`llm.py:248-249`).
- `question_versions.short_answer` is **nullable** (added post-hoc by `0016`). `model_answer` is
  `NOT NULL`. `views.py:1853` already uses `short_answer or model_answer`.
- `knowledge_chunks.embedding` is `vector(1536)` with `idx_knowledge_chunks_vector_hnsw`. **Do not
  touch.**
- Two `sp_record_llm_analysis` overloads exist: `pronargs` 11 (legacy, dead) and 20 (v3). The v3
  `CALL` has 21 placeholders (16 values + `NULL` for the OUT + 4 grounding).
- `submissions.tier3_reason` is read as `COALESCE(s.tier3_reason, s.answer_text)` (`llm.py:179`).
- **`analyze_submission` is NOT reachable from a web request.** Its only caller is
  `management/commands/analyze_submissions.py:26` — no view imports it. It runs in the polling worker.
- **`analyze_submissions.py:13`: "Zombies in ANALYZING > 10 min are marked `ANALYSIS_FAILED`"**, with
  `POLL_INTERVAL_SECONDS = 5`. `_recover_zombies()` re-claims anything left in `ANALYZING` past that
  window. This is the real reason generation must not run inline (§5).
- `knowledge_documents` already carries `ingest_status` / `ingest_error` / `chunk_count`
  (`models.py:443-445`) — the status-machine pattern to mirror.
- All domain models are `managed = False` (incl. `QuestionVersion` `:247`, `ReferenceAnswer` `:277`).
  Django `post_save` still fires for ORM writes; it does **not** fire for raw-SQL writes.
- `tests_reference_materials.py` holds **36** `def test_` methods (the HANDOFF says 34 — re-baseline
  from a live run, do not trust the doc).

## 1b. C0 baseline — measured 2026-10-14 on the live dev DB

Full record: `D:/ClinicalAI_Misconception/scripts/_c0_baseline.json`.
PostgreSQL **16.15**, pgvector **0.8.6**, highest migration `0024`, proc arities `11/20`, `manage.py check` clean,
**`api.tests_reference_materials`: 36 tests, OK, exit 0**.

| count | value |
|---|---|
| `llm_analyses` | **8** (4 with `grounding_similarity`) |
| `prompt_versions` | `four-tier-v2.9-rag` only |
| `validations` | **4** |
| `submissions` | 6 (2 `PENDING_VALIDATION`, 4 `VALIDATED`) |
| `questions` / `question_versions` | 3 / 3 (all 3 have non-empty `short_answer` **and** `model_answer`) |
| `knowledge_documents` / `chunks` | 3 / **330**, all 330 embedded |
| `reference_answers` | **2 rows, 1 of 3 question versions** — the mirror is incomplete |
| `misconceptions` / `question_version_misconceptions` | **0 / 0** |

Three consequences that must be respected by C1–C4:

1. **θ cannot be fitted from this DB.** 4 validations over 8 analyses. This is no longer a
   theoretical worry — it is the measured state. `verdict_agreement_rate` (D3) is the **only**
   calibration path, and the thresholds stay provisional until it produces a usable sample.
2. **The misconception catalog is empty**, so Modul C can only return `MK-LAIN` and `module_c_code` is
   NULL on every analysis. D12 therefore defers the per-misconception key: it would have been dead
   weight plus a NULL-uniqueness trap and an `ON DELETE SET NULL` cascade for zero benefit.
3. **C2 must reconcile the mirror before embedding.** The effective reference text lives on
   `question_versions` (3/3 populated); `reference_answers` is a partial mirror (2 rows). Embedding
   only what is in `reference_answers` would leave 2 of 3 question versions without a cached vector.

## 2. C1 — Migration `0026`

Highest existing migration is **`0025`** — the 2026-10-14 reconciliation's hand-written merge migration, which linearized the two `0024` leaves (`0024_admin_ai_model_settings` from `origin/main` and `0024_grounding_and_knowledge_ingest` from this branch). The repo now has **three** instances of that pattern: `0018`, `0020`, `0025`. **Do not create a duplicate leaf.** 7 columns:

```sql
ALTER TABLE reference_answers
    ADD COLUMN IF NOT EXISTS embedding   vector(1536),
    ADD COLUMN IF NOT EXISTS answer_hash CHAR(64);   -- sha256 of the effective reference text

ALTER TABLE llm_analyses
    ADD COLUMN IF NOT EXISTS answer_similarity_t1 NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS answer_similarity_t3 NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS llm_t1_score         VARCHAR(20),
    ADD COLUMN IF NOT EXISTS llm_t3_score         VARCHAR(20),
    ADD COLUMN IF NOT EXISTS verdict_shadow_json  JSONB NOT NULL DEFAULT '{}'::jsonb;
```

**Why `verdict_shadow_json` instead of columns.** The shadow verdict is only reproducible if the θ in
force at the time is recorded. Store
`{rule_t1, rule_t3, sim_t1, sim_t3, threshold_t1, threshold_t3, source}`. `answer_similarity_t1/t3` stay
first-class `NUMERIC` so means/medians compute in SQL; everything else lives in the JSONB. Without the
thresholds, `verdict_agreement_rate` is a moving target and history is uninterpretable.

- **Never overload** `grounding_similarity` / `_max` / `_citation_count` / `_payload_json`. Historical
  R1–R6 rows must stay interpretable.
- **No** `verdict_source` column. The setting selects the `PROMPT_VERSION` string
  (`four-tier-v3.0-rule` / `four-tier-v3.0-llm`), which the existing `llm_analyses.prompt_version`
  column already records per row — so a mid-deployment flip is auditable for free.
- **No** index on `reference_answers.embedding` (lookup is by PK).

`sp_record_llm_analysis` → **v4**:
- `DROP PROCEDURE IF EXISTS sp_record_llm_analysis(...)` using the **exact** v3 argument types
  (copy from `0024_grounding_and_knowledge_ingest.py:63`). **Leave the 11-arg overload alone.**
- Append the **5** new IN params **after** the grounding params, each `DEFAULT NULL`, keeping
  **`OUT p_analysis_id UUID` stays in its v3 slot** — after the 16 IN params, before the first
  defaulted param. PostgreSQL rejects an `OUT` parameter that follows a defaulted one (the constraint
  `0024` recorded), so "OUT last" is not achievable. Verified on the live v4: `p_analysis_id` sits at
  position 17, `pronargs` = 25 (25 IN + 1 OUT = 26 names). Result: `CALL` placeholders 21 → **26**.
- Body = the v3 body with the 5 new columns added to the `INSERT INTO llm_analyses` column list and
  `VALUES` list, and to the audit `metadata_json`.
- Cast **every** new placeholder at the call site (`%s::numeric`, `%s::varchar`, `%s::jsonb`).
- **Reverse** drops exactly those 5 `llm_analyses` columns plus the 2 `reference_answers` columns and
  restores the v3 procedure body verbatim.

**Backward compatibility is proven by execution, not by `pg_proc`** (§11.3): the existing
21-placeholder `CALL` must be executed on the migrated DB and write a row. Arity read from `pg_proc` is
corroboration only.

## 3. C2 — `manage.py sync_reference_embeddings`

**A change-detecting sync, not a one-time backfill** — hence the name. (Input 4, adopted.) Flags:
`--dry-run` (counts + token estimate, **zero network calls**), `--refresh` (the sweep), `--limit`,
`--question-version <id>`. Idempotent: a second run with no edits embeds **nothing** — an acceptance
criterion, not a nicety.

Change detection is `answer_hash` (C1): recompute sha256 of the *effective* reference text — the same
resolution `load_context` applies, `question_versions.short_answer` over the mirror — and embed only
rows where the hash is NULL, differs from the stored value, or `embedding` is NULL. A lecturer editing
`short_answer` or the mirror row changes the hash and the next pass refreshes that one vector. Cost ≈
one vector per question version, and zero when nothing changed.

**C0 forces an extra step:** the `reference_answers` mirror is incomplete (2 rows for 1 of 3 question
versions), while `question_versions.short_answer` / `.model_answer` are populated 3/3. The command
must therefore **reconcile the mirror first** — port `/ reuse `views.py:66 _sync_reference_answers`
for every question version that is missing `JAWABAN_SINGKAT` / `ALASAN` — and only then embed. Report
the reconcile counts (`created`, `already present`) separately from the embed counts. Do not embed
from `question_versions` directly while leaving `reference_answers` empty: C3 reads the cache from
`reference_answers` and would then miss 2 of 3 questions.

**Invalidation hooks** (D13) — both are required, because signals cannot see raw SQL:

| trigger | mechanism |
|---|---|
| `QuestionVersion` saved via the ORM (question edit / republish) | `post_save` → mark dependents `STALE` |
| `ReferenceAnswer` written via `_sync_reference_answers` | `post_save` → mark dependents `STALE` |
| raw-SQL writes (stored procs, psql, migrations, direct imports) | **`--refresh` sweep** — the backstop, run alongside the worker |
| `ingest_materials` completes a document | explicitly mark the subject's materials `STALE` (corpus changed) |

`post_save` fires for `managed = False` models on ORM saves. State plainly in the C2 report which paths
are signal-covered and which rely on the sweep — do not claim full coverage.

## 4. C3 — Similarity + **shadow** rule verdict

New, in `backend/api/embeddings.py` and `backend/api/llm.py`:

- `answer_similarity(t1_text, t3_text, ref_t1, ref_t3) -> (sim1, sim3)` — pure, no DB. Reuses
  `embeddings.cosine`. Exactly 2 network calls (the student's two texts). References come from the cache.
- `classify_tiers(...) -> (t1, t3, sim1, sim3)` — pure. `t1 = 'BENAR' if sim1 >= θ1 else 'SALAH'`.
  These verdicts are **stored in shadow**, not applied (§ settings).

`MATRIX_RULES` and `evaluate_decision_matrix` stay **byte-identical** (D4).

Settings appended to the existing `RETRIEVAL_*` block in `backend/config/settings.py`:

| Setting | Default | Note |
|---------|---------|------|
| `TIER_VERDICT_SOURCE` | **`'llm'`** | **Changed from `'rule'` on 2026-10-14.** The LLM verdict drives the matrix, so the diagnosis is preserved exactly. Flip to `'rule'` **only** after θ is calibrated. An uncalibrated threshold must never drive `SC`/`MSC` flips. |
| `SHADOW_RULE_VERDICT` | `True` | Compute and store the θ-based verdict plus both similarities even though they do **not** drive the matrix. This is the calibration dataset. |
| `ANSWER_SIM_T1_THRESHOLD` | `0.75` | **Provisional.** Never used for a live verdict while `TIER_VERDICT_SOURCE='llm'`. |
| `ANSWER_SIM_T3_THRESHOLD` | `0.75` | Separate from T1 on purpose — Tier-3 text is longer and more formulaic, so its cosine baseline is higher. |
| `READING_MATERIAL_TEMPERATURE` | `0.0` | Generation call only (the pipeline's `LLM_TEMPERATURE` is 0.1). |
| `READING_MATERIAL_MAX_RUNS` | `3` | Mirrors `LLM_MAX_RUNS`; caps flag → regenerate loops. |
| `READING_MATERIAL_DRAIN_BATCH` | `10` | Drain batch size. |

`CROSSCHECK_LLM_VERDICT` and `GENERATION_MISCONCEPTION_CONFIDENCE` from revision 1 are **withdrawn**:
the first is obsolete now that the LLM drives, the second goes with D12.

Modul A/B become **verdict-only for the matrix**: their scores go to `llm_t1_score` / `llm_t3_score` and
drive `t1`/`t3`. **Their `reasoning` and `student_feedback` output is RETAINED until C8 (D17) and keeps
being written into `concept_breakdown_json` exactly as today.** Do **not** strip it in C3:
`grounding_similarity`'s `advisory_text` is built from `student_feedback['konsep_seharusnya']`
(`llm.py:851`), so removing it makes every new row compute the still-live legacy metric from a different
input while C5 pools old and new rows in one mean. Nothing renders `student_feedback` today (it is typed
in `studentSubmissions.ts`, read by no `.tsx`), so keeping it costs nothing.

**Calibration procedure and shadow sunset (D16).** `verdict_agreement_rate` is a **diagnostic**, never a
tuning objective — the LLM verdict is itself unvalidated, so agreeing with it optimises "imitate an
unvalidated judge". θ is fitted **offline over lecturer-validated rows**, maximising agreement with the
lecturer's corrected tier (the ground truth `tier_agreement_accuracy` already uses). **Review point:
≥50 lecturer-validated analyses.** Below that, flipping `TIER_VERDICT_SOURCE` to `'rule'` is
**forbidden**. **Calibrate per model** — the 2026-10-14 reconciliation made the active model a runtime
setting (`ai_runtime_settings.active_model_id`, currently `openai/gpt-oss-20b`) and
`llm_analyses.model_identifier` now comes from it (`llm.py:787`). A θ fitted on one model does not
transfer to another; group the shadow sample by `model_identifier` and decide per model. At the review
point there are three legitimate outcomes: flip to `'rule'`; keep the shadow
(still inconclusive); or **delete the shadow** and revert C3's machinery. Without that third option the
shadow becomes permanent overhead — 2 embed calls per analysis for data nobody reads.

**Consequence to state, not hide:** because the LLM verdict still drives the matrix, C3 changes
**nothing** about the diagnosis in production. The shadow block is populated in parallel and the matrix
ignores it. That is the point: collect calibration evidence without moving a single verdict.

**Cost — revision-1 claim retracted.** "Per-analysis cost goes down" was wrong; it assumed the rule
drove the matrix. With `TIER_VERDICT_SOURCE='llm'` each analysis pays 2 verdict LLM calls (they drive)
**plus** 2 embed calls (the shadow). No saving. Calibration is then free: the similarities and both
verdicts are stored, so θ can be swept offline in pure SQL over historical rows, with no re-runs.

Edge cases that must be handled **and tested**, not assumed:
1. Empty Tier 1 → `SALAH` via the existing heuristic path, similarity `NULL`.
2. Empty `reference_short_answer` → fall back to `model_answer` (D2). If both are empty, similarity
   `NULL` and `t1` falls back to `'S'` — never an exception.
3. Zero-norm vector → `embeddings.cosine` already returns `0.0`.
4. Embeddings provider down → **non-fatal**, exactly like retrieval (HANDOFF rule 4): similarity
   `NULL`, the LLM verdict still drives, the analysis still reaches `PENDING_VALIDATION`.
5. `t3_kosong` path → no Modul C; similarities still computed for both tiers.
6. `BENAR_SEBAGIAN` → `'S'` (D4, existing behaviour).

## 5. C4 — Reading-material generation (asynchronous)

New table, a separate migration so C1 stays reversible alone:

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

**Revision-1 items withdrawn.** There is **no `misconception_id`** (D12). The key is
`(question_version_id, category)` and plain `UNIQUE` is correct here — the NULL-uniqueness trap, the
`UNIQUE NULLS NOT DISTINCT` requirement and the `COALESCE`-sentinel fallback from revision 1 **do not
apply** and are withdrawn with the column. `ON DELETE SET NULL` for `misconception_id` is also
withdrawn; `flagged_by` keeps a `SET NULL` because losing a user row must not delete the material.

- `CHECK (category IN ('LK','FP','FN','MSC'))` enforces **D6** (no material for `SC`) in the schema.
- `content_md` is nullable because a `PENDING` row has no content yet.
- Plain `UNIQUE` is safe to `ON CONFLICT (question_version_id, category) DO NOTHING` on — that is the
  get-or-create.

**Asynchronous, with an explicit queue and drain** (D11). Input 3's premise was wrong —
`analyze_submission` is worker-only, not a web request — but the action is right for a stronger reason:
the worker re-claims anything left in `ANALYZING` past **10 minutes** as `ANALYSIS_FAILED`
(`analyze_submissions.py:13`), so a long generation completion inside the analysis path could push a
**live** submission over that line and get it double-claimed. Therefore:

- the analysis path does only a cheap
  `INSERT ... ON CONFLICT (question_version_id, category) DO NOTHING` with `status='PENDING'`, **only
  when `category != 'SC'`**, and **never calls the LLM**;
- draining is **one** command, `manage.py drain_reading_materials --loop`, which per tick runs the C2
  `--refresh` sweep (a hash compare — change detection, not work, so it needs no schedule of its own),
  then a batch of `PENDING`/`STALE` material, then sleeps. Run it next to `analyze_submissions --loop`.
  Individual sub-modes stay available for manual use (`--pending`, `--refresh`, `--replace`,
  `--question-version <id>`), mirroring the `ingest_materials` drain. This is safe with respect to the
  10-minute zombie window because generation never sits inside an `ANALYZING` window (D18).

`generate_reading_material(ctx, category)`:
- Retrieves chunks exactly as R3 already does (`retrieve_reference_chunks`) and puts them in the
  prompt. Output JSON: `{"reading_material_md": "...", "sources": [{"chunk_id","document_id","document_title","page"}]}`.
- Instruction: use **only** the supplied chunks for factual claims. `temperature =
  READING_MATERIAL_TEMPERATURE` (0.0). `prompt_version = 'reading-material-v1.0'`.
- `sources[]` is filtered to chunk ids that were actually in the retrieved set; the residue is
  counted into `ungrounded_source_count`. This is the only detector standing in for the human
  backstop that D7 removes — it is a **data-quality flag**, not a citation-fidelity metric (D10).
- Zero retrieved chunks → still generate, `grounded = false`, `sources = []` (D8).
- **Non-fatal**: failure sets `status='FAILED'` + `error`, `attempts += 1`, retried by the drain up to
  `READING_MATERIAL_MAX_RUNS`. A generation failure must never fail an analysis.

**Fingerprint and invalidation.** `input_fingerprint` = sha256 over
`prompt_version | model_identifier | question_version_id | category | question prompt | effective
reference short answer | effective reference reason`. A pass whose fingerprint matches skips the row
entirely. **Corpus changes are caught by the ingest-side hook, not the fingerprint** — hashing chunk ids
would require the very retrieval call the fingerprint exists to avoid. The ingest hook marks the
affected subject's rows `STALE` (D13). Do **not** claim the fingerprint covers corpus drift.

**No misconception-branch caveat is needed any more** — that branch is gone with D12.

## 6. C5 — Metrics, **additive only**

**Add** (all computed over all current analyses in scope — D9, model-filter-aware, inherited from R5F):
`answer_similarity_t1_mean`, `_t1_median`, `_t3_mean`, `_t3_median`, `answer_similarity_by_category`,
`answer_similarity_by_prompt_version`, `answer_similarity_coverage`, `no_similarity_count`,
`verdict_agreement_rate`, `verdict_disagreement_count`, and
`reading_material_counts` (`READY`/`PENDING`/`STALE`/`FAILED`).

**Keep every existing key in this phase, including `grounding_*` and the citation rates** — but
**label them deprecated in the UI** (D19): `metrics/page.tsx` renders them as
*"(deprecated — digantikan Answer similarity)"*. Removal is C8, the last commit of the same release
(D15). Retaining a key protects code; a lecturer reading a plausible `grounding_similarity` of `1.0` is
a different failure mode and needs the UI-level fix.

**Every new aggregate is displayed with its denominator** (D9): `answer_similarity_coverage` /
`no_similarity_count` beside the means and medians, and `verdict_comparable_count` beside
`verdict_agreement_rate`. Rows with NULL similarities drop out of the rate, so an unreported denominator
silently biases it.

`METRICS_NOTE` (`backend/api/validation_views.py:648`) is rewritten in place to add: the new similarity
measures alignment with the **lecturer's reference answer**; the verdict is driven by the **LLM**, with
the θ-based rule recorded in shadow and **not** driving. The existing "keselarasan keluaran AI dengan
kutipan sumber" definition is retained for as long as the `grounding_*` keys live. The word "akurasi"
must not appear near any of it.

`_grounding_detail` gains `answer_similarity_t1/t3` and the shadow block **while keeping its existing
keys**, so pre-C5 analyses (NULL similarity) need no frontend guessing.

## 7. C6 — Lecturer surfaces

- `frontend/app/validation/[id]/page.tsx`: replace the "Sumber Referensi" block with the generated
  reading material + `sources[]` + both cosine values + the verdict and its source
  (`prompt_version`). Show the `grounded = false` warning when set. **No edit control.**
- `frontend/app/metrics/page.tsx`: the new keys, plus the shadow-vs-driving comparison
  (`verdict_agreement_rate`) and `reading_material_counts`. Zero-validations state keeps its shape.
- **Flag / regenerate** (D14) — a *review* action, not editing. `POST /api/materials/reading/{id}/flag`
  with `{note}`, gated to a lecturer of that subject, writing an audit row. Effects:
  `review_status='FLAGGED'`, `flag_note`, `flagged_by`, `flagged_at`, `status='STALE'`. The next drain
  regenerates with the note carried into the prompt ("the previous version was flagged for: …"), capped
  by `READING_MATERIAL_MAX_RUNS`. A lecturer must be able to mark bad material and get a replacement
  without being able to hand-edit text.
- **Staleness badge** (D18): the lecturer surfaces recompute the artifact's fingerprint /
  `answer_hash` **at read time** (no network call, no embedding) and badge a stale artifact —
  *"referensi berubah sejak materi ini dibuat"*. This is the only detector for an unstarted drain
  daemon, so it is not optional.
- **Deprecation labels** (D19) on the superseded metric keys, and denominators beside every new
  aggregate.
- Prod build on `:3002`; CDP pass via `scripts/r6_ui_audit.py`. **Stop the dev server first** —
  `:3001` belongs to the Hermes bridge.

## 8. C7 — Student surfaces

Student feedback (D1 of the Q&A) = final grade + per-question Benar/Salah + per-question reading
text. `views.py:2205 QuestionSetStudentReviewView` already returns `module_a_score`,
`module_b_score`, `four_tier_category`, `final_feedback`; note that commit `a6ed436` **already**
renders grounding citations on `questions/[id]/students/[studentId]`, which contradicts HANDOFF hard
rule 6. Extend that surface; do not add a second one. Serve material only for `status='READY'` rows —
never a `PENDING`/`FAILED` placeholder.

## 9. C8 — Contract removal

The **last commit of the same release** as C5 and C6 — verified after C6, not deployed months later
(D15). Backend and frontend are built and deployed together in a private architecture, so the
expand/contract split exists for *commit* and *verification* granularity, not for deployment safety.
Residual risk: an already-open browser tab holding the pre-C8 frontend bundle hits the post-C8 backend —
safe here because every affected field is optional in the TS types, so it degrades to a missing value and
clears on reload.

This phase also removes `student_feedback` / Modul B `reasoning` from `concept_breakdown_json` (D17),
together with the `grounding_*` keys whose input it feeds. Remove from the API payload (DB columns retained):
`grounding_similarity_mean`, `grounding_similarity_median`, `citation_validity_rate`,
`hallucinated_citation_rate`, `citation_coverage`, `grounding_by_category`,
`grounding_by_prompt_version`, `no_grounding_count`. They measured fidelity of a verdict's citations,
which no longer exists; a metric returning `1.0` while nothing validates anything is worse than no
metric. Then `frontend/app/lib/studentSubmissions.ts`'s `GroundingSummary` and any residual reader goes.

Expand-then-contract, because backend and frontend are separate deployables: an additive C5 can ship at
any time; a subtractive change cannot ship before its consumer is updated.

## 10. Hard rules

- **Never** run `makemigrations`.
- **Never** re-import `V2_Full_Script.sql`.
- Lifecycle writes go through stored procedures, not ORM `.update()`.
- Drop procedures **by exact signature**; prove arities after every migration direction.
- Retrieval and generation failures are **always non-fatal** to an analysis.
- Do not touch `knowledge_chunks.embedding`, `idx_knowledge_chunks_vector_hnsw`, or the 11-arg
  legacy overload.
- Do not overload the `grounding_*` columns.
- Do not present the new similarity as accuracy, and do not set the thresholds to values that look
  tuned when they are not — they are provisional until `verdict_agreement_rate` says otherwise.
- The reading material is never lecturer-editable (D7); flagging is a review action, not an edit.
- **Do not strip `student_feedback` / Modul B `reasoning` before C8** (D17) — the retained
  `grounding_similarity` is computed from it.
- **Do not flip `TIER_VERDICT_SOURCE` to `'rule'` below 50 lecturer-validated analyses** (D16), and never
  tune θ against the LLM verdict.
- The analysis path must **not** call the LLM for generation (10-minute zombie window).
- **C5 adds, C8 removes — never in the same release.**
- Never create app data to make a number line up — the dev DB is the evidence base, not a test DB.

## 11. Verification per phase

Raw output of every command, pasted in the report. Universal prerequisites:

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

Interpreter `backend/venv/Scripts/python.exe`. DB: docker `misconception_db`, `127.0.0.1:5433`,
`misconception_system`, user `postgres`. Docker Desktop is often **off** — start it first, then the
container.

Per phase: `manage.py check`; `manage.py test api.tests_reference_materials` (36 tests — baseline
first); migration forward → reverse → forward with `pg_proc` arity checks after **each** direction.
Phase-specific:

1. **C1 columns** — 7 present after forward, 0 after reverse; the 4 pre-existing `grounding_*` columns
   untouched; `knowledge_chunks.embedding` still `vector(1536)`; `git diff --stat backend/api/llm.py`
   empty.
2. **C1 arity** — `11` and `20` before, `11` and **`25`** after, back after reverse.
3. **C1 backward compatibility BY EXECUTION** — the existing 21-placeholder `CALL` executed against the
   migrated DB inside a transaction that is rolled back, so the evidence base gains no row:

   ```sql
   BEGIN;
   CALL sp_record_llm_analysis(<existing submission>, <20 values + NULL>);
   SELECT count(*) FROM llm_analyses WHERE submission_id = <existing submission>;  -- proves the write
   ROLLBACK;
   ```

   Then the same for the 26-placeholder path. Arity from `pg_proc` is corroboration only.
4. **C2 idempotence** — first `--refresh` embeds N; a second with no edits embeds **0**; reconcile counts
   reported separately; `--dry-run` performs zero network calls.
5. **C2 change detection** — edit one `short_answer` through the ORM path, confirm `answer_hash` differs
   and the sweep re-embeds exactly that one row, and confirm the signal marked dependents `STALE`.
6. **C3 neutrality** — after a real analysis, `llm_t1_score`/`llm_t3_score` populate, the matrix output
   is **identical** to pre-C3 for the same submission, and `verdict_shadow_json` carries both rule
   verdicts plus the thresholds in force.
   **D17 check:** `concept_breakdown_json.student_feedback.konsep_seharusnya` is still populated on the
   new row, and the new row's `grounding_similarity` is still computed from it (compare against the
   pre-C3 value for an equivalent submission). If `student_feedback` is empty, C3 has broken the
   retained legacy metric — stop and fix before proceeding.
7. **C4 async** — the analysis path creates a `PENDING` row and makes **no** generation call; the drain
   turns it `READY`; a second student in the same `(question_version, category)` reuses it
   byte-identically with no new call; a dead `EMBEDDINGS_BASE_URL` still reaches `PENDING_VALIDATION`
   and leaves the material `PENDING`/`FAILED`, never failing the analysis.
   **D18 check:** one `drain_reading_materials --loop` tick performs both the `--refresh` sweep and a
   material batch (show the log lines for both in one tick).
8. **C4 flag loop** — flag → `STALE` + note → drain regenerates with the note in the prompt → the
   attempt cap stops a repeat loop at `READING_MATERIAL_MAX_RUNS`.
9. **C5 additivity** — the payload contains **every** pre-C5 key **and** the new ones.
   **D19 check:** the frontend renders the superseded keys with their deprecation label, and every new
   aggregate has its denominator beside it (`answer_similarity_coverage` / `no_similarity_count`,
   `verdict_comparable_count`).
   **D18 check:** with a reference answer edited behind the cache's back, the lecturer surface badges the
   artifact as stale **without** any drain run.
10. **C6** — `npm run build` clean; `/materials` and `/metrics` in the route list; CDP pass on `:3002`.
11. **C8** — the last commit of the same release as C5/C6, verified after C6. The removed keys are gone,
    no frontend file still reads them, and `student_feedback` / Modul B `reasoning` are gone from
    `concept_breakdown_json` (D17). Confirm no new analysis can produce a `grounding_similarity` after
    this commit — the metric and its input leave together.
