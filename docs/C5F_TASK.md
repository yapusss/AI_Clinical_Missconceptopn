# C5F TASK — per-model answer-similarity and shadow-agreement keys in `by_model`

You are implementing **PHASE C5F ONLY** — a focused follow-up to C5. Authoritative spec:
`docs/COSINE_READING_MATERIAL_BRIEF.md` (**revision 3**) §6, and `../Context/Answer_Cosine_Plan.md`
**D16** (calibrate per model).

## Why this exists

C5 added the similarity/agreement keys **top-level only**. D16 requires the shadow sample to be grouped
**by `model_identifier`** and the flip decision taken **per model** — "a θ fitted on one model does not
transfer to another". The `by_model` array is where per-model numbers live, and it currently carries only
the validation-derived keys plus the minimum grounding set. So the per-model calibration D16 mandates
cannot be read from the payload.

**This is the same defect class as R5 → R5F**, and it is invisible on the dev DB because there is only
one `model_identifier`. That is exactly why it must be fixed and tested with a discriminating
combination rather than eyeballed.

## Deliverable

Extend `_by_model_row` in `backend/api/validation_views.py` so each row additionally carries, computed
from that model's own analyses in scope:

| key | definition |
|---|---|
| `answer_similarity_t1_mean` / `answer_similarity_t3_mean` | mean over that model's non-NULL similarities, rounded to 4 |
| `answer_similarity_coverage` | that model's non-NULL-similarity rows ÷ that model's analyses |
| `verdict_agreement_rate` | fraction where `llm_t1_score == rule_t1` **and** `llm_t3_score == rule_t3`, over that model's rows where **both** exist. `null` when the denominator is 0 |
| `verdict_comparable_count` | that model's denominator — the rows where both verdicts exist |

Rules:

- Use **the same filtered analysis list** the grounding keys already use. Do not introduce a second
  query — the R5F bug was caused by a fresh query that bypassed the model filter.
- **Add keys; remove nothing.** Existing `by_model` keys keep their current values.
- A model that has analyses but **no validations** must still report these keys (the row already exists
  for grounding — same reasoning).
- `null`/`0` where there is no data. Never `0.0` for an agreement rate with a zero denominator, never
  `1.0` by default.

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- **Do not create data to make a number non-null.** The dev DB is the evidence base.
- Do not touch `llm.py`, `MATRIX_RULES`, migrations, `reading_materials.py`, or the drain.
- Keep the existing **59 + your C5 additions** green.

## Environment

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

Interpreter `backend/venv/Scripts/python.exe`. DB: docker `misconception_db`, `127.0.0.1:5433`.
**The Django backend is already running on `127.0.0.1:8000`** — do **not** restart it; if you must,
restart it with `--noreload` and leave it running when you finish.

## Verification — run all of these and paste the RAW output

1. `manage.py check`
2. `manage.py test api.tests_reference_materials` — all green. Paste `Ran N tests` / `OK`.
3. **Per-model keys present** — fetch `/api/metrics/model` and show one `by_model` row in full,
   confirming all four new keys exist alongside the existing ones.
4. **The discriminating test** (this is the acceptance criterion): with the real model present,
   `?model=<the real identifier>` must equal the unfiltered payload apart from the echoed `model_filter`,
   and `?model=openai/does-not-exist` must return the zero-analyses shape (`by_model []`) — never pooled
   numbers. Paste both.
5. **Additivity preserved** — the top-level key set must still contain all 21 pre-C5 keys plus the 12
   C5 additions (`scripts/_c5_pre_key_set.json` holds the 21). Paste the diff.
6. `scripts/r4_audit.py` — still `fails: 0` and the PDF-anchored block unchanged
   (`mean=0.5465 median=0.5465 coverage=1.0 validity=1.0`). Paste the verdict block.
7. Evidence base intact: `llm_analyses=8`, `PENDING_VALIDATION=2`, `VALIDATED=4`, `questions=3`,
   `generated_reading_materials=2`.
8. `py_compile` on every edited file.

## Finish

Commit exactly:

```
fix(api): per-model answer-similarity and shadow-agreement keys in by_model
```

Report back: files changed, raw verification output, commit hash, and anything you could not verify.
**Do not start C6.**
