# C3 TASK — answer similarity + the shadow rule verdict

You are implementing **PHASE C3 ONLY**. Authoritative spec: `docs/COSINE_READING_MATERIAL_BRIEF.md`
(**revision 3**) — read §1, §4, §10, §11.6 first. Decision record: `../Context/Answer_Cosine_Plan.md`
(D2, D4, D11, D16, D17 — outside the repo).

Implement C3 and **nothing** from later phases: no reading-material generation, no metrics changes, no
UI, no `post_save` signals, no migration.

## The one thing that must not change

**`TIER_VERDICT_SOURCE` is `'llm'`.** The LLM verdict keeps driving the matrix, so **C3 changes no
diagnosis in production**. The cosine verdict is computed and stored **in shadow** and the matrix
ignores it. An uncalibrated threshold must never drive an `SC`/`MSC` flip. Do not "improve" this
default.

## Deliverables

### 1. `backend/api/embeddings.py` — the similarity function

```python
def answer_similarity(t1_text, t3_text, ref_t1_vec, ref_t3_vec) -> tuple[float | None, float | None]:
```

- Embeds **only the student's two texts** — exactly 2 provider calls. The reference side comes from the
  **cache** (`reference_answers.embedding`, populated by C2).
- Compares with the existing `cosine()`. Returns `(sim1, sim3)`, each rounded to 4 decimals.
- **Never embed the reference text here.** If a cached vector is missing, that side is `None` — do not
  fall back to embedding on the fly, which would break the "cached, never recomputed" contract (D2) and
  add a hidden per-analysis call.
- Empty/blank student text → `None` for that tier (do **not** embed an empty string).
- Provider failure → raise the existing `EmbeddingError`; the caller handles it.

### 2. `backend/api/llm.py` — the rule verdict, pure

```python
def classify_tiers(sim1, sim3, threshold_t1, threshold_t3) -> tuple[str | None, str | None]:
```

- `'BENAR' if sim >= threshold else 'SALAH'`, per tier.
- **`None` similarity → `None` verdict**, never `'SALAH'`. A missing measurement must not be recorded as
  a judgement; the agreement metric counts only rows where both sides exist.
- Pure: no DB, no network.

### 3. `backend/api/llm.py` — wire it into the pipeline

- **`load_context`** additionally loads the two cached reference vectors from `reference_answers`
  (`JAWABAN_SINGKAT` → tier-1 reference vector, `ALASAN` → tier-3 reference vector). It already queries
  that table (`llm.py:260`) — extend the query with `embedding`. Add them to `FourTierContext`.
- **In `analyze_submission`**, compute the shadow **in both branches** (the `t3_kosong` path and the
  normal path) — similarity is a property of the submission, not of which modules ran. Wrap it in
  `try/except EmbeddingError` and degrade to `None`s: retrieval/embedding failure is **always
  non-fatal** (HANDOFF rule 4).
- When `settings.SHADOW_RULE_VERDICT` is **False**, skip the computation entirely (zero embed calls) and
  store `None` similarities and `None` rule verdicts.
- **The driving verdict:**

  | column | meaning |
  |---|---|
  | `llm_t1_score` / `llm_t3_score` (**new columns**) | the **LLM's** verdict, always recorded from Modul A/B, **independent of `TIER_VERDICT_SOURCE`** |
  | `module_a_score` / `module_b_score` (existing `CALL` params) | the **driving** verdict — what the matrix actually consumed |
  | `verdict_shadow_json` | rule verdicts + both similarities + both thresholds in force + `source` |

  Under the default `'llm'` the two verdict pairs are equal. Under `'rule'` they diverge and `llm_*` is
  the only record of what the LLM said — which is what calibration needs.

- **Safeguard C** (`mod_b_score == 'BENAR'` and ≤3 words and no math derivation) stays where it is and
  applies to the **LLM verdict**, *before* source selection. Do not let it corrupt a rule verdict.
- `verdict_shadow_json` shape:
  `{"rule_t1":…, "rule_t3":…, "sim_t1":…, "sim_t3":…, "threshold_t1":…, "threshold_t3":…, "source":"llm"}`.
  The thresholds **must** be recorded — without them the shadow verdict is unreproducible.
- **`PROMPT_VERSION` becomes source-derived**, e.g. `f'four-tier-v3.0-{settings.TIER_VERDICT_SOURCE}'`.
  It currently reads `'four-tier-v2.9-rag'` (`llm.py:39`). Metrics group by prompt version, so the 8
  existing rows must stay in their own bucket — never pool a judged run with a shadow run.

### 4. `backend/api/llm.py` — the `CALL` grows to 26 placeholders

Append the 5 new values after the 4 grounding values, in the order C1 declared:
`p_answer_similarity_t1, p_answer_similarity_t3, p_llm_t1_score, p_llm_t3_score, p_verdict_shadow_json`
(cast `%s::numeric`, `%s::numeric`, `%s::varchar`, `%s::varchar`, `%s::jsonb`). `pronargs` is **25**;
the `CALL` takes **26** placeholders (the 17th is the `NULL` for `OUT p_analysis_id`).

### 5. Do NOT touch

- **`student_feedback` / Modul B `reasoning` must keep being produced and written into
  `concept_breakdown_json` exactly as today** (D17). `grounding_similarity`'s `advisory_text` is built
  from `student_feedback['konsep_seharusnya']` (`llm.py:873`, the `advisory_text` assignment); stripping it here would silently redefine
  a metric that stays live until C8 and make C5 pool two different quantities in one mean.
- **`MATRIX_RULES` and `evaluate_decision_matrix` stay byte-identical** (D4).
- `PROMPT_VERSION`'s old literal must not survive as a second constant.
- Do not change `grounding_*`, `models.py`, `settings.py`, `validation_views.py`, or any migration.

## Tests

Add unit tests for the pure functions in `api/tests_reference_materials.py` (same file, same style):

- `classify_tiers` at the threshold boundary (`sim == threshold` → BENAR), above, below, and with `None`.
- `answer_similarity` with mocked embeddings: identical texts → 1.0, orthogonal → 0.0, blank text →
  `None` for that tier, missing cached reference vector → `None`.
- **A mocked-pipeline test** extending the existing `ZeroChunkPipelineTests` style (it already patches
  the LLM and captures `CALL` params) asserting: the `CALL` carries **26** placeholders;
  `llm_t1_score`/`llm_t3_score` equal the Modul A/B verdicts; `module_a_score`/`module_b_score` equal
  them too under the default `'llm'`; `verdict_shadow_json` carries both rule verdicts, both
  similarities, both thresholds and `source`; `student_feedback` is **still present** in
  `concept_breakdown_json`.

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- **Never** run a real analysis against the dev DB — there is no un-analysed submission, and creating one
  mutates the evidence base. Prove behaviour with mocked pipeline tests. This is the acceptance
  criterion, not a preference.
- Retrieval and embedding failures are **always non-fatal**.
- Keep the existing 36 tests green.

## Environment

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

Interpreter `backend/venv/Scripts/python.exe`. DB: docker `misconception_db`, `127.0.0.1:5433`,
`misconception_system`, user `postgres`. Docker Desktop is often off — start it, then the container.

## Verification — run all of these and paste the RAW output

1. `manage.py check`
2. `manage.py test api.tests_reference_materials` — 36 existing + your new tests, all green. Paste the
   final `Ran N tests` / `OK` lines.
3. `git diff` showing `MATRIX_RULES` and `evaluate_decision_matrix` are **untouched**.
4. `grep -n "four-tier-v" backend/api/llm.py` — show the source-derived `PROMPT_VERSION`.
5. Show the new `CALL` has 26 placeholders (`grep -c '%s'` on the call, or paste the call).
6. Show the new tests by name and that they pass.
7. Evidence base intact:
   ```bash
   docker exec misconception_db psql -U postgres -d misconception_system -tAc "SELECT 'llm_analyses='||COUNT(*) FROM llm_analyses UNION ALL SELECT status||'='||COUNT(*) FROM submissions GROUP BY status ORDER BY 1;"
   ```
   Expected: `llm_analyses=8`, `PENDING_VALIDATION=2`, `VALIDATED=4`.
8. `python -m py_compile` on every edited backend file.

## Finish

Commit exactly:

```
feat(api): answer similarity and shadow rule verdict in the analysis pipeline
```

Report back: files changed, raw verification output, commit hash, and anything you could not verify.
**Do not start C4.**
