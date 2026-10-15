# C8 TASK — contract removal (the last commit of this release)

You are implementing **PHASE C8 ONLY — the final phase.** Authoritative spec:
`docs/COSINE_READING_MATERIAL_BRIEF.md` (**revision 3**) — read §1, §9, §10, §11.11 first. Decision
record: `../Context/Answer_Cosine_Plan.md` (D10, D15, D17, D19 — outside the repo).

C8 is the **contract** half of expand-then-contract. C5 added, C6/C7 consumed, **C8 removes.** Backend and
frontend ship together, so this is the last commit of one release — but it is a **separate commit**, and
everything it removes must have no remaining reader.

## What to remove, and only what has no reader left

### 1. Top-level metric keys — remove these 8 from the API payload

```
grounding_similarity_mean      grounding_similarity_median
citation_coverage              citation_validity_rate
hallucinated_citation_rate     grounding_by_category
grounding_by_prompt_version    no_grounding_count
```

**The DB columns stay** (`grounding_similarity`, `_max`, `_citation_count`, `_payload_json`) — historical
R1–R6 rows must remain interpretable. Only the API surface goes.

Also remove the **deprecation labels** for them in `frontend/app/metrics/page.tsx` — the keys they
deprecate no longer exist, so the labels are now dead text. Keep the `bukan akurasi` caveats.

### 2. Per-analysis detail keys — remove from `_grounding_detail`

`grounding_similarity`, `grounding_payload`, `grounding`. The **`references`** key **stays** — it is the
provenance of the generated reading material (D10), not of a verdict.

### 3. `student_feedback` / Modul B `reasoning` — the D17 removal

Now that C8 removes the metric whose input they feed (`grounding_similarity`'s `advisory_text` is built
from `student_feedback['konsep_seharusnya']`), remove them **together**:

- Stop Modul B producing `student_feedback` and `reasoning`, and shrink its prompt accordingly.
- Remove `student_feedback` from `concept_breakdown_json`.
- Remove the `StudentFeedbackDetail` type and `student_feedback` field from
  `frontend/app/lib/studentSubmissions.ts`, and any residual reader.
- **Check `validation/[id]/page.tsx` and the student page for readers first** — at the time of writing
  neither renders it, but confirm rather than assume, and remove any that exist.

**Order matters:** the metric and its input leave in the same commit. Removing `student_feedback` earlier
was forbidden (D17) precisely because `grounding_similarity` still read it.

### 4. `frontend/app/lib/studentSubmissions.ts`

Remove `GroundingSummary` and any field that only fed the removed keys. Keep `reading_material`,
`reading_material_counts`, the similarity fields, and everything else.

### 5. `scripts/r4_audit.py` — it will fail after this; fix it, don't delete it

It lives **outside the repo** (parent directory) so your edit is **not committed** — say so in your report.
It currently asserts "all 8 grounding keys present at top level", "by_model rows carry the required
grounding keys" and a **PDF-anchored block** (`mean=0.5465 median=0.5465 coverage=1.0 validity=1.0`).
Those keys are now gone from the API.

**Replace, never delete:**

- The grounding-key assertions become assertions on the **new** keys (`answer_similarity_*`,
  `answer_similarity_coverage`, `no_similarity_count`, `verdict_agreement_rate`,
  `verdict_comparable_count`, `reading_material_counts`).
- The **PDF-anchored block must become a raw-SQL assertion** over the retained DB columns — i.e. prove
  the historical grounding data is still intact in `llm_analyses` even though the API no longer exposes
  it. That is exactly what D10 requires, and it is a *stronger* test than the HTTP one it replaces.
  Use `docker exec misconception_db psql …` as the other scripts do.
- Keep the R5F model-filter assertions and the detail-contract probes, updated for the removed keys.

**Acceptance: `fails: 0`**, pasted.

### 6. `scripts/r6_ui_audit.py` — likewise outside the repo

It asserts `deprecated — digantikan Answer similarity` renders. Those labels are gone in C8. Replace that
assertion with one asserting the **superseded cards are absent** from `/metrics` (no
`grounding_similarity_mean` / `citation_validity_rate` / `no_grounding_count` rendered), and keep the rest
— including the student-page positive/negative material assertions and the `bukan akurasi` check.

**Acceptance: `fails: 0`**, pasted.

## Live facts

- `llm_analyses` 8 rows: all have NULL `answer_similarity_*` and empty `verdict_shadow_json`; 4 have
  non-NULL `grounding_similarity` (the historical R1–R6 rows). Those 4 are the raw-SQL anchor — their
  values must be **unchanged** after C8.
- `generated_reading_materials` 2 rows, both `UNREVIEWED`: `(qv …0004, FN)` **READY** with real generated
  content (2293 chars, 3 sources) and `(qv …0004, MSC)` READY. The FN one now renders live on the student
  page for set `…0002` (3 questions) while the SC question returns null — the UI audit asserts both.
- Backend on `127.0.0.1:8000`; prod frontend on `:3002`. **Rebuild and re-serve `:3002`** after frontend
  edits, and leave both running.
- The dev DB is the **evidence base**: do not create submissions, analyses, questions, subjects or users.

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- **Do not drop or alter any DB column.** C8 changes the API surface only.
- Remove a payload key only after confirming no reader remains — `grep` the frontend for each one and say
  what you found.
- Do not touch `MATRIX_RULES`, `evaluate_decision_matrix`, the migrations, `reading_materials.py`, the
  drain, or the C6 flag endpoint.
- Do not create app data to make anything non-empty.
- Keep every test that still applies green; **delete only tests that asserted a removed key**, and say
  which you deleted and why.

## Environment

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

Interpreter `backend/venv/Scripts/python.exe`. DB: docker `misconception_db`, `127.0.0.1:5433`.
Frontend `frontend/` (Next.js), prod build served on `:3002`.

## Verification — run all of these and paste the RAW output

1. `manage.py check`
2. `manage.py test api.tests_reference_materials` — all green. Paste `Ran N tests` / `OK`.
3. **Removed keys are gone** — fetch `/api/metrics/model` and show the 8 keys are absent and the new keys
   are present. Paste the key list.
4. **Detail payload** — `/api/validations/<analysis_id>` has no `grounding_similarity` /
   `grounding_payload` / `grounding`, but **still has `references`**. Show it.
5. **`student_feedback` gone** — show it is absent from `concept_breakdown_json`, and paste the `grep`
   results proving no frontend reader remains.
6. **Historical data intact (raw SQL)** — the 4 non-NULL `grounding_similarity` rows are **unchanged**:
   paste the values before and after.
7. **`scripts/r4_audit.py`** — paste the verdict. **Acceptance: `fails: 0`.** Show the new raw-SQL
   PDF-anchored assertion.
8. **`scripts/r6_ui_audit.py`** — paste the verdict. **Acceptance: `fails: 0`.** Show the new
   "superseded cards absent" assertion.
9. **`npm run build`** clean; `npx tsc --noEmit` clean.
10. Evidence base intact: `llm_analyses=8`, `PENDING_VALIDATION=2`, `VALIDATED=4`, `questions=3`,
    `generated_reading_materials=2` (both `UNREVIEWED`).
11. `py_compile` on every edited backend file.

## Finish

Commit exactly:

```
refactor(api): remove superseded grounding metric keys and student_feedback (contract)
```

Report back: files changed, raw verification output, commit hash, which tests you deleted and why, and
anything you could not verify. **This is the last phase — do not start anything else.**
