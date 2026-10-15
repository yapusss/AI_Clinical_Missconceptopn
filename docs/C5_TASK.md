# C5 TASK — metrics: answer similarity, shadow agreement, reading-material counts

You are implementing **PHASE C5 ONLY**. Authoritative spec: `docs/COSINE_READING_MATERIAL_BRIEF.md`
(**revision 3**) — read §1, §6, §10, §11.9 first. Decision record:
`../Context/Answer_Cosine_Plan.md` (D9, D10, D11, D16, D19 — outside the repo).

Implement C5 and **nothing** from later phases: no UI, no flag endpoint, no contract removal.

## The rule that defines this phase: ADD, DO NOT REMOVE

**Every existing metric key stays.** `grounding_*`, `citation_coverage`, `citation_validity_rate`,
`hallucinated_citation_rate`, `no_grounding_count`, `grounding_by_category`,
`grounding_by_prompt_version` — all of them remain in the payload, byte-identical in meaning.

Removal is **C8**, the last commit of this release (D15/D19). A subtractive change in C5 would break
the frontend, which is deployed alongside it.

## Deliverables

### 1. `backend/api/validation_views.py` — extend `_grounding_metrics`

Keep every key it returns today. **Add**:

| key | definition |
|---|---|
| `answer_similarity_t1_mean` / `_t1_median` / `_t3_mean` / `_t3_median` | over `answer_similarity_t1` / `_t3` where non-NULL, rounded to 4 |
| `answer_similarity_coverage` | rows with a non-NULL `answer_similarity_t1` ÷ total analyses |
| `no_similarity_count` | total − rows with a non-NULL `answer_similarity_t1` |
| `answer_similarity_by_category` | bucket per `four_tier_category` |
| `answer_similarity_by_prompt_version` | bucket per `prompt_version` — this is how a judged run stays separate from a shadow run |
| `verdict_agreement_rate` | over rows where **both** verdicts exist: fraction where `llm_t1_score == rule_t1` **and** `llm_t3_score == rule_t3`. `None` when the denominator is 0 |
| `verdict_disagreement_count` | the complement |
| `verdict_comparable_count` | **the denominator** — rows where both verdicts exist |
| `reading_material_counts` | `{'READY': n, 'PENDING': n, 'STALE': n, 'FAILED': n, 'total': n}` from `generated_reading_materials`, **filtered to the analyses' question versions in scope** |

The rule verdicts live inside `verdict_shadow_json` (`rule_t1` / `rule_t3`), so read them from the JSONB.

**Every aggregate carries its denominator.** Rows with NULL similarities drop out of the means; rows
without a shadow drop out of the agreement rate. An unreported denominator silently biases the number —
this is why `answer_similarity_coverage` / `no_similarity_count` / `verdict_comparable_count` exist.

### 2. The two invariants inherited from R4/R5F — both still apply

- **All current analyses in scope, not only validated ones** (D9). The similarity block is a property of
  the analysis, and must be present even when there are **zero** validations. `_zero_validation_payload`
  must include every new key too.
- **The `?model=` filter must narrow the new blocks.** `_scope_analyses(user, subject_id, model_filter)`
  and `_filter_analyses_by_model` already enforce this for grounding; the new similarity/agreement
  aggregates must come from the **same filtered list**, in **both** branches. This exact bug shipped once
  (R5 → R5F) and was invisible because the dev DB has few models. Test it explicitly with
  `?model=openai/does-not-exist` → the new keys must be `null` / `0` / `{}`, never pooled numbers.

### 3. `_grounding_detail` — extend, keep the shape

Keep every existing key (`concept_breakdown_json`, `references`, `what_should_be_learned`,
`suggested_materials`, `grounding_similarity`, `grounding_payload`, `grounding`). **Add**
`answer_similarity_t1`, `answer_similarity_t3`, `llm_t1_score`, `llm_t3_score`, and `verdict_shadow`
(from `verdict_shadow_json`). Pre-C5 rows have NULLs — the frontend must not have to guess, so keep the
keys present with `null` rather than omitting them.

### 4. `METRICS_NOTE`

Currently:

> Metrik kesesuaian = perbandingan dengan validasi dosen (satu-satunya ground truth di sistem).
> Metrik grounding = keselarasan keluaran AI dengan kutipan sumber yang dipilihnya sendiri; tidak
> memerlukan validasi dosen dan BUKAN akurasi.

**Append** the new definitions — do not replace the existing sentence, because the `grounding_*` keys
still exist until C8:

- Answer similarity = `cosine(student answer, lecturer reference answer)`, measured against the
  **lecturer's** reference answer, needing no lecturer validation, and **BUKAN akurasi**.
- The verdict is **driven by the LLM**; the θ-based rule is recorded **in shadow** and does **not** drive
  any category. `verdict_agreement_rate` measures how often the two disagree — it is a diagnostic, not a
  quality score, and **calibration is against the lecturer, never against the LLM** (D16).

The word "akurasi" must not appear next to the similarity keys except inside the "BUKAN akurasi"
disclaimer.

### 5. `scripts/r4_audit.py` — update its two stale static assertions

`scripts/r4_audit.py` lives **outside the repo** (parent directory), so your edit there is not committed —
say so in your report. It currently reports 2 FAILs that are **expected drift from C3, not regressions**:

```
[FAIL] PROMPT_VERSION four-tier-v2.9-rag: NOT found in api/llm.py
[FAIL] expected 21 slots at the record call site, found 26 (25 placeholders)
```

`PROMPT_VERSION` is now source-derived, and the `CALL` legitimately grew to 26 slots. Update those two
assertions so the harness is a clean gate again — expect the source-derived form, and expect 26 slots.
**Change nothing else in the harness**, and in particular leave the PDF-anchored grounding block and the
R5F model-filter assertions intact: those are the regression tests for the retained metrics.

## Live facts

- `llm_analyses` has 8 rows, **all with NULL** `answer_similarity_t1` / `verdict_shadow_json` (no live
  analysis has run since C3). So the new aggregates are legitimately `null`/`0` on the dev DB — that is
  the correct output, **not** a bug to work around.
- `generated_reading_materials` has 2 fixture rows: `(…004, MSC)` `READY` and `(…004, FN)` `FAILED`.
- `prompt_version` for existing rows is `four-tier-v2.9-rag`; new runs would be
  `four-tier-v3.0-llm`. `answer_similarity_by_prompt_version` must not pool them.
- Do not touch `MATRIX_RULES`, `evaluate_decision_matrix`, `student_feedback`, `llm.py`, or any migration.

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- **Remove nothing** from the payload.
- **Do not create data to make a number non-null.** The dev DB is the evidence base; a fabricated
  similarity row is worse than a null.
- Keep the existing **59** tests green.

## Environment

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

Interpreter `backend/venv/Scripts/python.exe`. DB: docker `misconception_db`, `127.0.0.1:5433`,
`misconception_system`, user `postgres`. Docker Desktop is often off — start it, then the container.

`scripts/r4_audit.py` exists and already asserts the R5F model-filter invariant plus the PDF-anchored
grounding block. Run it before and after your change and paste both results; the PDF-anchored numbers
must be **unchanged**.

## Verification — run all of these and paste the RAW output

1. `manage.py check`
2. `manage.py test api.tests_reference_materials` — 59 existing + your new tests, all green.
3. **Additivity, proven mechanically.** The pre-C5 pooled key set was captured on 2026-10-14 via
   `scripts/r4_audit.py --json` and saved to `scripts/_c5_pre_key_set.json`. **All 21 of these must still
   be present after your change:**

   ```
   total_validations, rejection_rate, scored_validations, tier_agreement_accuracy, macro_f1, per_tier,
   confusion_matrix, percentage_mae, percentage_rmse, calibration, expected_calibration_error,
   grounding_similarity_mean, grounding_similarity_median, citation_coverage, citation_validity_rate,
   hallucinated_citation_rate, grounding_by_category, grounding_by_prompt_version, no_grounding_count,
   by_model, note
   ```

   Fetch `/api/metrics/model` after your change, diff the key set against that list, and paste the diff.
   A missing pre-C5 key is a FAIL.
4. **The new keys exist** with the expected shapes, including in the **zero-validations** payload.
5. **`?model=openai/does-not-exist`** → the new similarity/agreement keys are `null`/`0`/`{}` and
   `reading_material_counts.total` is `0`, never pooled numbers. Same for
   `?subject_id=<a subject with no analyses>&model=<bogus>`.
6. **`reading_material_counts`** reflects the 2 fixture rows (`READY: 1`, `FAILED: 1`).
7. **`verdict_comparable_count` is `0`** on the dev DB (no shadow data yet) and
   `verdict_agreement_rate` is therefore `null` — not `0.0`, not `1.0`. This is the honest output; prove
   it rather than inventing data.
8. `scripts/r4_audit.py` before/after — the PDF-anchored block unchanged.
9. Evidence base intact: `llm_analyses=8`, `PENDING_VALIDATION=2`, `VALIDATED=4`, `questions=3`,
   `generated_reading_materials=2`.
10. `py_compile` on every edited backend file.

## Finish

Commit exactly:

```
feat(api): answer-similarity, shadow-agreement and reading-material metrics (additive)
```

Report back: files changed, raw verification output, commit hash, and anything you could not verify.
**Do not start C6.**
