# C7 TASK — student surfaces, and restoring the UI audit as a working gate

You are implementing **PHASE C7 ONLY**. Authoritative spec: `docs/COSINE_READING_MATERIAL_BRIEF.md`
(**revision 3**) — read §1, §8, §10, §11 first. Decision record:
`../Context/Answer_Cosine_Plan.md` (D1, D6, D9, D17 — outside the repo).

C7 has **two** deliverables. The second one exists because C6 left the repo's UI audit red.

## Part 1 — student surfaces

Student feedback is: **final grade + per-question Benar/Salah + the LLM-generated reading material per
question.** Nothing else.

### Backend — `views.py:2205 QuestionSetStudentReviewView`

It already returns `module_a_score`, `module_b_score`, `four_tier_category`, `final_feedback`. **Add,
per question:**

- `reading_material` for that question, looked up by `(question_version_id, four_tier_category)` and
  **served only when `status='READY'`**. When the row is `PENDING`/`STALE`/`FAILED`, or when the
  category is `SC` (D6 — no remediation for a fully-correct confident student), return `null`. **Never
  render a placeholder for unfinished material** — the student sees the material or nothing.
- Include `content_md` and `sources[]` (the user's spec is "the text **and** the reference the LLM used").
- Keep every existing key.

**Do NOT expose lecturer-only diagnostics to students**: no `answer_similarity_*`, no `verdict_shadow`,
no `llm_t1_score`/`llm_t3_score`, no `review_status`/`flag_note`, no `stale` badge. Those are the
lecturer's surface.

### Frontend

Extend the **existing** student review surface — `frontend/app/questions/[id]/students/[studentId]/page.tsx`,
which commit `a6ed436` already extended with grounding citations. **Do not add a second surface.** Note
that `a6ed436` put *citations* there; those are the verdict's citations, and C6 replaced their lecturer
equivalent with the reading material. Replace them here too, for the same reason, so the student sees the
material the LLM wrote for them rather than the model's citation list.

Render per question: the question, Tier-1 and Tier-3 Benar/Salah, the category, and the reading material
when present (markdown + its sources). Plus the final grade, which already renders.

Follow the file's existing styles. No restyling.

## Part 2 — restore `scripts/r6_ui_audit.py` as a working gate

It is currently **red: `fails: 15, passed: 3`**, and it cannot get past login. It lives **outside the
repo** (parent directory), so your edit there is **not committed** — say so in your report.

Two distinct problems, and both must be fixed properly:

1. **Login fails.** C6's run reproduced it deterministically: the prod login page SSR-renders its form
   text immediately, so `wait_text` returns **before React hydrates**, and the click is a no-op — the run
   stays on `/login`. The harness worked at R6 time; `frontend/app/login/page.tsx` changed in the
   2026-10-14 merge, which is the likely cause. Fix the harness's login step with a **hydration settle**
   (wait for the interactive form, not just the text) — do not paper over it with a fixed `sleep` if a
   condition-based wait is available.

2. **Three assertions are obsolete, not broken.** C6 legitimately replaced the "Sumber Referensi" block
   with the reading material, so assertions on `Sumber Referensi`, the PDF title and the citation page
   number no longer describe the UI. **Replace them — do not delete them** — with assertions on the
   surfaces C6 actually shipped:
   - the `Materi Bacaan` block renders
   - the cosine values render under the label `Keselarasan dengan jawaban referensi dosen`
   - the word **`akurasi`** does **not** appear next to the similarity values
   - the flag control (`Tandai perlu diperbaiki`) is present
   - the superseded metric keys carry `deprecated — digantikan Answer similarity`
   - `verdict_comparable_count` / `reading_material_counts` render on `/metrics`

   Deleting an assertion to get green is a FAIL. The gate must describe the app that exists.

**Acceptance:** the harness runs to completion against `:3002` with **0 fails**, and you paste its verdict.

## Live facts

- The Django backend is running on `127.0.0.1:8000`; the prod frontend build is on `:3002`. Rebuild after
  your frontend edits (`npm run build`) and re-serve `:3002`.
- **The READY material is reachable from no analysis detail** — both fixture rows are on question version
  `…0004`, and every analysis on `…0004` is category `FN`, which resolves the `FAILED` row. The
  `(…0004, MSC)` `READY` row with 3 real sources has no matching analysis. So expect the student view to
  show `FAILED`/no material on those questions. **Report this honestly** — do not create an analysis to
  make it render, and do not present the empty state as a rendering bug.
- All 8 analyses have NULL similarities and empty shadow JSON. Lecturer diagnostics will be empty; that is
  correct.
- `submissions` has 6 rows (2 `PENDING_VALIDATION`, 4 `VALIDATED`), 3 questions, 3 question versions.

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- **Do not create app data** (no submissions, analyses, questions, subjects, users) to make a UI state
  non-empty.
- Serve reading material to students **only** when `status='READY'`.
- Do not expose lecturer diagnostics on the student surface.
- Do not touch `MATRIX_RULES`, `evaluate_decision_matrix`, `llm.py`, `reading_materials.py`, migrations,
  the drain, or the C6 flag endpoint.
- Keep the existing **91** tests green.

## Environment

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

Interpreter `backend/venv/Scripts/python.exe`. DB: docker `misconception_db`, `127.0.0.1:5433`.
Frontend: `frontend/` (Next.js). Prod build served on `:3002`.

## Verification — run all of these and paste the RAW output

1. `manage.py check`
2. `manage.py test api.tests_reference_materials` — 91 existing + your new tests, all green.
3. **Student payload** — `GET` the student review endpoint for a real student/question set and show, per
   question: Tier-1/Tier-3 Benar/Salah, category, and the `reading_material` value. Show a question whose
   category is `SC` returning `null` (no material) and one whose material is `FAILED` returning `null`
   (not a placeholder).
4. **Lecturer diagnostics are absent** from the student payload — `grep` the response for
   `answer_similarity`, `verdict_shadow`, `llm_t1_score`, `review_status`, `stale` and show they are
   absent.
5. **READY-only rule** — a test asserting that a `PENDING`/`FAILED` row yields `null` to the student while
   a `READY` row yields content.
6. **`npm run build`** clean; paste the `/questions/[id]/students/[studentId]` route line.
7. **`scripts/r6_ui_audit.py`** — paste the full verdict. **Acceptance: `fails: 0`.** Also paste the new
   assertions by name so it is visible what replaced the obsolete ones.
8. **No `akurasi`** near the similarity label — `grep` the rendered/built page.
9. Evidence base intact: `llm_analyses=8`, `PENDING_VALIDATION=2`, `VALIDATED=4`, `questions=3`,
   `generated_reading_materials=2` (both `UNREVIEWED`, one `READY`, one `FAILED`).
10. `py_compile` on edited backend files; `npx tsc --noEmit` on edited TS.

## Finish

Commit exactly:

```
feat(ui): student reading-material and per-question verdict surfaces
```

Report back: files changed, raw verification output, commit hash, what you could **not** render, and
anything you could not verify. **Do not start C8.**
