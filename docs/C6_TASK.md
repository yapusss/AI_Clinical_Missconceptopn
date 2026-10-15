# C6 TASK — lecturer surfaces: reading material, flag/regenerate, staleness badge, deprecation labels

You are implementing **PHASE C6 ONLY**. Authoritative spec: `docs/COSINE_READING_MATERIAL_BRIEF.md`
(**revision 3**) — read §1, §7, §9, §10, §11.9–11.10 first. Decision record:
`../Context/Answer_Cosine_Plan.md` (D7, D14, D18, D19 — outside the repo).

C6 is the **only** phase in this release with frontend work. It also adds the one backend surface the
frontend needs. No student surfaces (that is C7), no key removal (that is C8).

## Deliverables

### 1. Backend — expose the reading material on the analysis detail

`_grounding_detail` in `backend/api/validation_views.py` already builds the payload
`frontend/app/validation/[id]/page.tsx` consumes. **Add** a `reading_material` block (keep every
existing key):

```
reading_material: {
  status, content_md, sources, grounded, ungrounded_source_count,
  stale, stale_reason, review_status, flag_note, prompt_version, model_identifier, attempts
}
```

- Look the row up by `(analysis.question_version_id, analysis.four_tier_category)`. **Return `null` when
  there is no row** — an `SC` analysis legitimately has none (D6), and so does an analysis enqueued
  before the drain ran.
- **`stale` is computed at read time, server-side**: recompute `input_fingerprint(...)` from the current
  question text and reference answers and compare it to the stored value. This is a local sha256 — **no
  network call, no embedding**. When it differs, `stale = true` and `stale_reason` says the reference or
  question changed. This is the only detector for an unstarted drain daemon (D18), so it is not optional.
- Expose `answer_similarity_t1`, `answer_similarity_t3`, `llm_t1_score`, `llm_t3_score` and
  `verdict_shadow` too if C5 did not already (it did — verify, do not duplicate).

### 2. Backend — `POST /api/materials/reading/{id}/flag`

- Body `{"note": "..."}`; `note` optional but recorded verbatim.
- **Permission: a lecturer of that reading material's subject only** (reuse the existing
  `is_lecturer_for_subject` / `_lecturer_subject_ids` helpers). Non-lecturer → **403**.
- Effects on the row: `review_status='FLAGGED'`, `flag_note`, `flagged_by=request.user`,
  `flagged_at=now()`, and **`status='STALE'`** so the next drain regenerates it.
- The row's own `flagged_by` / `flagged_at` / `flag_note` **are** the audit trail — do **not** invent a
  new audit table. Also emit a `logger.info` line naming the material id, the flagger and the note.
- Return the updated row's key fields so the UI can reflect it without a refetch.
- Register the route in `backend/api/urls.py`. Match the existing naming style.

**This is review, not editing.** Do **not** add any endpoint that writes `content_md`. A lecturer must be
able to reject an artifact and get a replacement; they must not be able to hand-edit the text (D7).

### 3. Frontend — `frontend/app/validation/[id]/page.tsx`

Replace the grounding-only block with a **reading material** block, keeping the existing surrounding
styles (this file is 957 lines; follow its conventions, do not restyle it):

- `content_md` rendered as the reading material. **No edit control, no textarea, no save button.**
- `sources[]` listed with `document_title` + page (the payload already carries titles — C6-era R work).
- When `grounded === false`, show a visible warning: the material was generated **without** reference
  materials. When `ungrounded_source_count > 0`, say how many cited sources did not resolve.
- Both cosine values (`answer_similarity_t1` / `_t3`) with the label **"Keselarasan dengan jawaban
  referensi dosen"** — and **never** the word "akurasi".
- The driving verdict and its source (`prompt_version`), plus the shadow verdict, labelled as **not**
  driving.
- A **staleness badge** when `stale === true`: *"referensi berubah sejak materi ini dibuat"* + reason.
- A **flag control**: a small "Tandai perlu diperbaiki" action with an optional note, calling the new
  endpoint. After success, reflect `review_status`/`status` locally.
- Keep `student_feedback` / `what_should_be_learned` / `misconception_matches` / `heuristic_flags`
  rendering exactly as it is today.

### 4. Frontend — `frontend/app/metrics/page.tsx`

- Render the new keys: the four similarity aggregates, `answer_similarity_coverage`,
  `no_similarity_count`, `verdict_agreement_rate`, `verdict_comparable_count`,
  `verdict_disagreement_count`, `reading_material_counts` (READY/PENDING/STALE/FAILED).
- **Every new aggregate shows its denominator** (D19): coverage / `no_similarity_count` beside the means
  and medians; `verdict_comparable_count` beside the agreement rate.
- **Label the superseded keys as deprecated while they still exist** (D19):
  `grounding_similarity_mean`, `grounding_similarity_median`, `citation_coverage`,
  `citation_validity_rate`, `hallucinated_citation_rate`, `no_grounding_count`, and the two
  `grounding_by_*` breakdowns get *"(deprecated — digantikan Answer similarity)"*. They are removed in
  C8, not now — but a lecturer must not keep reading a plausible number that no longer means anything.
- Add the **shadow vs driving** comparison surface using `verdict_agreement_rate` +
  `verdict_comparable_count`, labelled as a diagnostic, **not** an accuracy figure.
- `reading_material_counts` renders the drain backlog (PENDING/STALE/FAILED) — this is the operator's
  only view of an unattended queue.
- **Remove nothing** — every existing card stays.

### 5. Types

`frontend/app/lib/studentSubmissions.ts` — extend the relevant interfaces with the new fields
(`reading_material`, `answer_similarity_t1/t3`, `verdict_shadow`, the new metric keys). Keep every
existing field. Note: `student_feedback` stays until C8 (D17).

## Live facts

- `generated_reading_materials` has **2 fixture rows**, both on question version `…0004`:
  `(…0004, MSC)` `READY`, `grounded=true`, 3 sources; `(…0004, FN)` `FAILED`, `attempts=3`.
  Whether `validation/[id]` can show them depends on which analyses are in that question version —
  report honestly what you were able to render.
- All 8 analyses have **NULL** `answer_similarity_*` and empty `verdict_shadow_json`, so the similarity
  UI will render empty/placeholder states. **That is correct** — do not create data to make it non-empty.
- The frontend builds to `:3002`. **Stop the `:3001` dev server first if running** — that port belongs to
  something else. `scripts/r6_ui_audit.py` drives the CDP pass (`--base http://127.0.0.1:3002`).
- The Django backend is already running on `127.0.0.1:8000`.

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- **No edit surface for reading material** — flag/regenerate only.
- **Remove nothing** from any payload or page.
- Do not touch `MATRIX_RULES`, `evaluate_decision_matrix`, `llm.py`, `reading_materials.py`,
  migrations, or the drain command.
- Do not create app data to make a UI state non-empty.
- Keep the existing **76** tests green.

## Environment

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

Interpreter `backend/venv/Scripts/python.exe`. DB: docker `misconception_db`, `127.0.0.1:5433`.
Frontend: `frontend/` (Next.js; `node_modules` present). Prod build on `:3002`.

## Verification — run all of these and paste the RAW output

1. `manage.py check`
2. `manage.py test api.tests_reference_materials` — 76 existing + your new tests, all green.
3. **Flag endpoint** — `POST /api/materials/reading/<id>/flag` as a lecturer returns 200 and the row
   becomes `review_status='FLAGGED'`, `status='STALE'`, `flagged_at` set, `flag_note` recorded. Paste the
   before/after row. **Then restore the fixture row** to `READY` / `UNREVIEWED` so C7 sees the same state
   (say how you restored it).
4. **Permission** — the same call as a **non-lecturer** (or unauthenticated) returns **403**/401.
5. **Detail payload** — `/api/validations/<analysis_id>` now carries `reading_material` with the full key
   set, and `stale` is present and boolean. Show one real payload.
6. **Staleness is real** — inside a transaction you roll back, change a reference answer and show
   `stale` flips to `true` with a reason. Show the rollback and that the value returns afterwards.
7. **No edit surface** — show that no route accepts `content_md` (`grep` the urls + views).
8. **Frontend build** — `npm run build` completes clean. Paste the route list line for `/metrics` and
   `/validation/[id]`.
9. **CDP pass** — `scripts/r6_ui_audit.py --base http://127.0.0.1:3002` and paste its verdict. If it
   cannot reach the page, say so plainly rather than claiming a pass.
10. **Deprecation labels present** — `grep` the built/rendered metrics page for
    `deprecated — digantikan Answer similarity`.
11. Evidence base intact: `llm_analyses=8`, `PENDING_VALIDATION=2`, `VALIDATED=4`, `questions=3`.
12. `py_compile` on edited backend files; `npx tsc --noEmit` (or the project's typecheck) on edited TS.

## Finish

Commit exactly:

```
feat(ui): lecturer reading-material surface, flag/regenerate, staleness badge and metric labels
```

Report back: files changed, raw verification output, commit hash, what you could **not** render, and
anything you could not verify. **Do not start C7.**
