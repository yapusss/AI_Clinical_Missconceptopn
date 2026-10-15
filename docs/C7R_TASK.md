# C7R TASK — finish C7: the student page, and restore the UI audit gate

**Context: a previous delegated session for C7 was interrupted for inactivity.** Its backend half was
recovered, verified and committed as `5db5850`. **Do not redo the backend.** What remains is the frontend
and the audit harness.

Authoritative spec: `docs/COSINE_READING_MATERIAL_BRIEF.md` (**revision 3**) §8, §10, §11. Original task:
`docs/C7_TASK.md` — read it for the full intent; this file is the remaining scope.

## Already done (do not touch, do not re-implement)

`backend/api/views.py` already has, and `5db5850` committed:

- `_STUDENT_HIDDEN_ANALYSIS_KEYS` — strips `answer_similarity_t1/t3`, `llm_t1_score/t3_score`,
  `verdict_shadow` from the student payload.
- `_student_reading_material(question_version_id, category)` — returns `{content_md, sources}` **only**
  for a `status='READY'` row; `None` for absent / `PENDING` / `STALE` / `FAILED` / `SC`. No lecturer
  review/flag/staleness fields.
- `_student_analysis_detail(analysis, breakdown, question_version_id)` — wraps `_grounding_detail`,
  pops the hidden keys, adds `reading_material`.

**98 tests are green.** Leave the backend alone unless a test you add needs a change.

## Remaining work

### 1. Frontend — the student review page

`frontend/app/questions/[id]/students/[studentId]/page.tsx`. Commit `a6ed436` put the **verdict's
citation list** there; C6 replaced its lecturer equivalent with the reading material, and the same applies
here — replace it, so the student sees the material the LLM wrote for them rather than the model's
citations.

Render, per question:

- the question, and **Tier-1 / Tier-3 Benar/Salah** (`module_a_score` / `module_b_score`) and the
  category (`four_tier_category`);
- the **reading material** when `reading_material` is non-null: `content_md` rendered as markdown, plus
  its `sources[]` (the user's spec is "the text **and** the reference the LLM used");
- the final grade, which already renders.

When `reading_material` is `null`, render **nothing** for it — no placeholder, no "material unavailable"
box. `SC` students legitimately get none (D6).

**Never** render lecturer diagnostics here: no cosine values, no shadow verdict, no `review_status`,
`flag_note` or staleness badge. Those are C6's lecturer surface.

Follow the file's existing styles. No restyling.

### 2. Types — `frontend/app/lib/studentSubmissions.ts`

Add the `reading_material` shape (`{content_md: string | null; sources: ...[]} | null`) to the relevant
interface. Keep every existing field — `student_feedback` stays until C8 (D17).

### 3. Restore `scripts/r6_ui_audit.py` as a working gate

It lives **outside the repo** (parent directory) so your edit is **not committed** — say so in your report.
It currently reports **`fails: 15, passed: 3`** and cannot get past login.

**(a) Login fails.** Reproduced deterministically: the prod login page SSR-renders its form text
immediately, so `wait_text` returns **before React hydrates**, and the click is a no-op — the run stays on
`/login`. The harness worked at R6; `frontend/app/login/page.tsx` changed in the 2026-10-14 merge, the
likely cause. Fix it with a **condition-based hydration wait** (wait for the interactive form), not a
fixed `sleep`.

**(b) Three assertions are obsolete, not broken.** C6 legitimately replaced the "Sumber Referensi" block,
so assertions on `Sumber Referensi`, the PDF title and the citation page number no longer describe the UI.
**Replace them — never delete them** — with assertions on what actually shipped:

- the `Materi Bacaan` block renders on `/validation/[id]`
- the cosine values render under `Keselarasan dengan jawaban referensi dosen`
- the word **`akurasi`** does **not** appear next to the similarity values
- the flag control `Tandai perlu diperbaiki` is present
- the superseded metric keys carry `deprecated — digantikan Answer similarity`
- `verdict_comparable_count` and `reading_material_counts` render on `/metrics`
- the student page renders the reading material for a `READY` question and **nothing** for a `null` one

Deleting an assertion to reach green is a **FAIL**. The gate must describe the app that exists.

**Acceptance: `fails: 0`**, pasted.

## Live facts

- Backend on `127.0.0.1:8000`; prod frontend on `:3002`. **Rebuild (`npm run build`) and re-serve `:3002`
  after your edits** — a stale build will make the audit assert against the old UI.
- **The `READY` material is reachable from no analysis detail**: both fixture rows are on question version
  `…0004`, and every analysis on `…0004` is category `FN`, which resolves the `FAILED` row. So expect the
  student page to show no material for those questions. **Report that honestly** — do not create an
  analysis to make it render.
- All 8 analyses have NULL similarities and empty shadow JSON. Lecturer diagnostics are empty; correct.
- `submissions` 6 rows (2 `PENDING_VALIDATION`, 4 `VALIDATED`), 3 questions, 3 question versions,
  `generated_reading_materials` 2 rows (one `READY`, one `FAILED`, both `UNREVIEWED`).

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- **Do not create app data** to make a UI state non-empty.
- Serve reading material to students **only** when `status='READY'`.
- Do not expose lecturer diagnostics on the student surface.
- Do not touch `MATRIX_RULES`, `evaluate_decision_matrix`, `llm.py`, `reading_materials.py`, migrations,
  the drain, the C6 flag endpoint, or the C7 backend functions listed above.
- Keep the existing **98** tests green.

## Environment

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

Interpreter `backend/venv/Scripts/python.exe`. DB: docker `misconception_db`, `127.0.0.1:5433`.
Frontend `frontend/` (Next.js), prod build served on `:3002`.

## Verification — run all of these and paste the RAW output

1. `manage.py check`
2. `manage.py test api.tests_reference_materials` — **98** existing + any you add, all green.
3. **`npm run build`** clean; paste the `/questions/[id]/students/[studentId]` route line.
4. **Student payload** — for a real student/question set, show per question: Tier-1/Tier-3 Benar/Salah,
   category, and the `reading_material` value. Show an `SC` question returning `null` and a `FAILED`-material
   question returning `null` (not a placeholder).
5. **Lecturer diagnostics absent** — `grep` the student response for `answer_similarity`, `verdict_shadow`,
   `llm_t1_score`, `review_status`, `stale`; show they are absent.
6. **`scripts/r6_ui_audit.py`** — paste the full verdict. **Acceptance: `fails: 0`.** Paste the new
   assertions by name so what replaced the obsolete ones is visible.
7. **No `akurasi`** near the similarity label in the rendered/built page.
8. Evidence base intact: `llm_analyses=8`, `PENDING_VALIDATION=2`, `VALIDATED=4`, `questions=3`,
   `generated_reading_materials=2` (both `UNREVIEWED`).
9. `npx tsc --noEmit` on edited TS; `py_compile` on any edited backend file.

## Finish

Commit exactly:

```
feat(ui): student reading-material surfaces and restored UI audit gate
```

Report back: files changed, raw verification output, commit hash, what you could **not** render, and
anything you could not verify. **Do not start C8.**
