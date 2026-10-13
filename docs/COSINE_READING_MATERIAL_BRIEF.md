# Answer-Cosine + LLM-Generated Reading Material — Implementation Brief

Authoritative spec for phases **C1–C7**. Read with
`Context/Answer_Cosine_Plan.md` (locked decisions D1–D10, rationale, cost model).

This brief is **additive** to `docs/REFERENCE_MATERIALS_IMPLEMENTATION_BRIEF.md`. Nothing in R1–R6 is
deleted except the metric keys named in §6, which become meaningless under the new definition.

Phase order is strict. Each phase ends with a commit and a report; do not start the next phase.

| Phase | Scope | Depends on |
|-------|-------|------------|
| **C0** | Baseline numbers, DB up, branch safety net | — |
| **C1** | Migration `0025`: 5 columns, `sp_record_llm_analysis` v4 | C0 |
| **C2** | `embed_reference_answers` command + backfill | C1 |
| **C3** | Cosine thresholds, rule verdict, `verdict_source` | C2 |
| **C4** | Reading-material generation: prompt, table, cache, drain | C3 |
| **C5** | Metrics redefinition | C4 |
| **C6** | Lecturer surfaces | C5 |
| **C7** | Student surfaces (grade + per-question B/S + reading text) | C6 |

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
- `tests_reference_materials.py` currently holds **36** `def test_` methods (the HANDOFF says 34 —
  re-baseline from a live run, do not trust the doc).

## 2. C1 — Migration `0025`

Highest existing migration is `0024`. Do **not** create a duplicate leaf (the repo has a
merge-migration pattern: `0016`/`0018`, `0019`/`0020`).

```sql
ALTER TABLE reference_answers
    ADD COLUMN IF NOT EXISTS embedding vector(1536);

ALTER TABLE llm_analyses
    ADD COLUMN IF NOT EXISTS answer_similarity_t1   NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS answer_similarity_t3   NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS llm_t1_score           VARCHAR(20),
    ADD COLUMN IF NOT EXISTS llm_t3_score           VARCHAR(20);
```

- **Never overload** `grounding_similarity` / `_max` / `_citation_count` / `_payload_json`. Historical
  R1–R6 rows must stay interpretable.
- **No** `verdict_source` column. The setting selects the `PROMPT_VERSION` string
  (`four-tier-v3.0-rule` / `four-tier-v3.0-llm`), which the existing `llm_analyses.prompt_version`
  column already records per row — so a mid-deployment flip is auditable for free.
- **No** index on `reference_answers.embedding` (lookup is by PK).

`sp_record_llm_analysis` → **v4**:
- `DROP PROCEDURE IF EXISTS sp_record_llm_analysis(...)` using the **exact** v3 argument types
  (copy from `0024_grounding_and_knowledge_ingest.py:63`). **Leave the 11-arg overload alone.**
- Append the 4 new IN params **after** the grounding params, each `DEFAULT NULL`, keeping
  `OUT p_analysis_id UUID` last. Result: `pronargs` 20 → **24**; `CALL` placeholders 21 → **25**.
- Body = the v3 body with the 4 new columns added to the `INSERT INTO llm_analyses` column list and
  `VALUES` list, and to the audit `metadata_json`.
- Cast **every** new placeholder at the call site (`%s::numeric`, `%s::varchar`).
- **Reverse** drops exactly those 5 columns and restores the v3 procedure body verbatim.

## 3. C2 — `manage.py embed_reference_answers`

Backfill `reference_answers.embedding`. Reuses `api/embeddings.py:embed_texts`. Flags: `--dry-run`
(row count + token estimate, **zero network calls**), `--replace`, `--limit`. Idempotent: skip rows
with a non-null vector unless `--replace`. Prefer the effective reference text (i.e. the same
resolution `load_context` applies: `question_versions.short_answer` over the mirror), so the cached
vector matches what C3 will compare against. Cost ≈ one vector per question version.

## 4. C3 — Similarity + rule verdict

New, in `backend/api/embeddings.py` and `backend/api/llm.py`:

- `answer_similarity(t1_text, t3_text, ref_t1, ref_t3) -> (sim1, sim3)` — pure, no DB. Reuses
  `embeddings.cosine`. Exactly 2 network calls (the student's two texts). References come from the
  cache.
- `classify_tiers(...) -> (t1, t3, sim1, sim3, source)` — pure. `t1 = 'BENAR' if sim1 >= θ1 else 'SALAH'`.

`MATRIX_RULES` and `evaluate_decision_matrix` stay **byte-identical** (D4).

Settings appended to the existing `RETRIEVAL_*` block in `backend/config/settings.py`:

| Setting | Default | Note |
|---------|---------|------|
| `ANSWER_SIM_T1_THRESHOLD` | `0.75` | **Provisional.** Must be calibrated from `verdict_agreement_rate` (C5), not treated as a tuned value. |
| `ANSWER_SIM_T3_THRESHOLD` | `0.75` | Separate from T1 on purpose: Tier-3 reasons are longer and more formulaic, so their cosine baseline is higher and they will need a different value. |
| `TIER_VERDICT_SOURCE` | `'rule'` | `'rule'` \| `'llm'`. Drives `t1`/`t3` into the matrix. |
| `CROSSCHECK_LLM_VERDICT` | `True` | When `False`, Modul A/B verdict calls are skipped entirely and `llm_t1_score`/`llm_t3_score` stay NULL. |
| `GENERATION_MISCONCEPTION_CONFIDENCE` | `0.75` | D5 gate. Below this, the material is generated at category level (`misconception_id = NULL`). |
| `READING_MATERIAL_TEMPERATURE` | `0.0` | Applies to the generation call only; the pipeline's `LLM_TEMPERATURE` is 0.1. |

Modul A/B prompts shrink to **verdict-only** (drop the `reasoning` field, drop everything that builds
`student_feedback`). Their outputs go to `llm_t1_score` / `llm_t3_score` and **never** into
`concept_breakdown_json`. When `TIER_VERDICT_SOURCE='llm'`, the same values additionally feed the
matrix.

Edge cases that must be handled **and tested**, not assumed:
1. Empty Tier 1 → `SALAH` via the existing heuristic path, similarity `NULL`.
2. Empty `reference_short_answer` → fall back to `model_answer` (D2). If both are empty, similarity
   `NULL` and `t1` falls back to `'S'` — never an exception.
3. Zero-norm vector → `embeddings.cosine` already returns `0.0`.
4. Embeddings provider down → **non-fatal**, exactly like retrieval (HANDOFF rule 4): similarity
   `NULL`, verdict from the LLM side if `CROSSCHECK_LLM_VERDICT`, analysis still reaches
   `PENDING_VALIDATION`.
5. `t3_kosong` path → no Modul C, no `misc_id`; similarity for T3 still computed.
6. `BENAR_SEBAGIAN` → `'S'` (D4, existing behaviour).

## 5. C4 — Reading-material generation

New table (`0026`, or appended to `0025` if C1 has not been committed yet — prefer a separate
migration so C1 stays reversible alone):

```sql
CREATE TABLE generated_reading_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_version_id UUID NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
    category VARCHAR(10) NOT NULL CHECK (category IN ('LK','FP','FN','MSC')),
    misconception_id UUID REFERENCES misconceptions(id) ON DELETE SET NULL,
    content_md TEXT NOT NULL,
    sources_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    grounded BOOLEAN NOT NULL DEFAULT FALSE,
    ungrounded_source_count INT NOT NULL DEFAULT 0,
    model_identifier VARCHAR(100) NOT NULL,
    prompt_version VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE NULLS NOT DISTINCT (question_version_id, category, misconception_id)
);
```

- `CHECK (category IN ('LK','FP','FN','MSC'))` enforces **D6** (no material for `SC`) in the schema.
- `UNIQUE NULLS NOT DISTINCT` requires PostgreSQL 15+. Dev DB is pg16. **Run
  `SHOW server_version` on any other target first**; if older, use
  `UNIQUE (question_version_id, category, COALESCE(misconception_id, '00000000-0000-0000-0000-000000000000'::uuid))`.
  Plain `UNIQUE` is **wrong** here — PostgreSQL treats NULLs as distinct and duplicates will
  accumulate.
- `misconception_id` is set only when Modul C matched a real catalog row **and** its confidence is
  `>= GENERATION_MISCONCEPTION_CONFIDENCE` (D5). Otherwise `NULL`.

`generate_reading_material(ctx, category, misconception_id)`:
- Retrieves chunks exactly as R3 already does (`retrieve_reference_chunks`) and puts them in the
  prompt. Output JSON: `{"reading_material_md": "...", "sources": [{"chunk_id","document_id","document_title","page"}]}`.
- Instruction: use **only** the supplied chunks for factual claims. `temperature =
  READING_MATERIAL_TEMPERATURE` (0.0). `prompt_version = 'reading-material-v1.0'`.
- `sources[]` is filtered to chunk ids that were actually in the retrieved set; the residue is
  counted into `ungrounded_source_count`. This is the only detector standing in for the human
  backstop that D7 removes — it is a **data-quality flag**, not a citation-fidelity metric (D10).
- Zero retrieved chunks → still generate, `grounded = false`, `sources = []` (D8).
- **Non-fatal**: a generation failure must never fail an analysis. Wrap it the way retrieval is
  wrapped.

Trigger: get-or-create at the end of `analyze_submission`, after the category is known, **only when
`category != 'SC'`**. Plus `manage.py generate_reading_material --pending/--loop/--replace/--question-version <id>`
mirroring the `ingest_materials` drain. `--replace` is the only regeneration path (D7: no UI edit).
Never generate inside a web request.

## 6. C5 — Metrics redefinition

**Add** (all computed over all current analyses in scope — D9, model-filter-aware, inherited from
R5F): `answer_similarity_t1_mean`, `answer_similarity_t1_median`, `answer_similarity_t3_mean`,
`answer_similarity_t3_median`, `answer_similarity_by_category`, `answer_similarity_by_prompt_version`,
`answer_similarity_coverage`, `no_similarity_count`, `verdict_agreement_rate`,
`verdict_disagreement_count`.

**Remove from the API payload** (DB columns retained): `grounding_similarity_mean`,
`grounding_similarity_median`, `citation_validity_rate`, `hallucinated_citation_rate`,
`citation_coverage`, `grounding_by_category`, `grounding_by_prompt_version`, `no_grounding_count`.

`METRICS_NOTE` (`backend/api/validation_views.py:648`) must be rewritten: it currently defines the
metric as alignment between the AI's output and its own cited sources. It must now state that the
similarity is measured against the **lecturer's reference answer** and that the verdict is
**rule-based and not lecturer-validated**. The word "akurasi" must not appear near it.

`_grounding_detail` → `_answer_similarity_detail`; keep a stable shape so pre-C5 analyses (NULL
similarity) do not require frontend guessing.

## 7. C6 — Lecturer surfaces

- `frontend/app/validation/[id]/page.tsx`: replace the "Sumber Referensi" block with the generated
  reading material + `sources[]` + both cosine values + the verdict and its source
  (`prompt_version`). Show the `grounded = false` warning when set. **No edit control.**
- `frontend/app/metrics/page.tsx`: new keys, new labels, `MetricCard` "Tanpa Similarity" replaces
  "Tanpa Grounding". Zero-validations state keeps its existing shape.
- Prod build on `:3002`; CDP pass via `scripts/r6_ui_audit.py`. **Stop the dev server first** —
  `:3001` belongs to the Hermes bridge.

## 8. C7 — Student surfaces

Student feedback (D1 of the Q&A) = final grade + per-question Benar/Salah + per-question reading
text. `views.py:2205 QuestionSetStudentReviewView` already returns `module_a_score`,
`module_b_score`, `four_tier_category`, `final_feedback`; note that commit `a6ed436` **already**
renders grounding citations on `questions/[id]/students/[studentId]`, which contradicts HANDOFF hard
rule 6. Extend that surface; do not add a second one.

## 9. Hard rules

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
- The reading material is never editable by a lecturer (D7).

## 10. Verification per phase

Raw output of every command, pasted in the report. Universal prerequisites:

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

Interpreter `backend/venv/Scripts/python.exe`. DB: docker `misconception_db`, `127.0.0.1:5433`,
`misconception_system`, user `postgres`. Container is **stopped by default** — start it first.

Per phase: `manage.py check`; `manage.py test api.tests_reference_materials` (baseline first — the
suite is 36 tests, not the 34 in the HANDOFF); migration forward/reverse/forward with
`pg_proc` arity checks after **each** direction; and the phase-specific probes in §2–§8.
