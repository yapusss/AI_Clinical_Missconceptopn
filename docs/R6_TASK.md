# R6 TASK — lecturer surfaces: `/materials`, `/metrics`, citations on `validation/[id]`

You are implementing **PHASE R6** of the reference-materials feature. Authoritative spec:
`docs/REFERENCE_MATERIALS_IMPLEMENTATION_BRIEF.md` §10.2–§10.5 (+ §2b defaults, §13 must-not-do) and
`Context/Reference_Materials_Plan.md` §9b #10 / §10. R5/R5F are done and audited; their API contract is frozen.

**Files you may touch — nothing else:**

| File | Change |
|---|---|
| `backend/api/validation_views.py` | `_grounding_detail` (`:55`): add `document_title` to every reference entry |
| `backend/api/tests_reference_materials.py` | tests for that mapping; keep the existing 34 green |
| `frontend/app/lib/studentSubmissions.ts` | shared citation / learning-list types |
| `frontend/app/validation/[id]/page.tsx` | two new blocks + grounding score; extend its local `llm` type (`:65–88`) |
| `frontend/app/materials/page.tsx` | **new** — upload / list / delete |
| `frontend/app/metrics/page.tsx` | **new** — metrics + grounding panel |
| `frontend/app/components/AppSidebar.tsx` | two `MENU_ITEMS` entries (ADMIN + LECTURER) |

No new backend endpoint, no schema change, no other page, no student surface (R7).

## State you must trust (verified live 2026-10-12; do not re-derive)

**`GET /api/materials`** (optional `?subject_id=`) → list of the caller's lecture subjects, each row:
`id, subject_id, topic_id, title, mime_type, ingest_status, ingest_error, chunk_count, created_at, file_name`
(basename only; no `raw_text`, no absolute path). A subject the caller does not lecture → 403. A caller with no
lecturer grant gets `200 []` on the unfiltered list — **do not build the UI assuming 403**.

**`POST /api/materials`** (multipart) `file` + `subject_id` (+ optional `topic_id`, `title`) → **201** with
`ingest_status: "PENDING"`; ≤25 MB; `.pdf/.md/.txt/.markdown`; 400 otherwise. Ingestion is **staged**: nothing is
embedded in the request. A `manage.py ingest_materials --pending` poller drains it to `READY` (or `FAILED` with
`ingest_error`). The page must say so, or a lecturer will read PENDING as a broken upload.

**`DELETE /api/materials/<uuid>`** → **204**; the document row goes, `knowledge_chunks` cascade, the stored file is
removed. 403 for a subject the caller does not lecture, 404 unknown.

**`GET /api/metrics/model`** (`?subject_id=`, `?model=`) → validation-derived keys (`total_validations`,
`scored_validations`, `rejection_rate`, `tier_agreement_accuracy`, `macro_f1`, `per_tier`, `confusion_matrix`,
`percentage_mae`, `percentage_rmse`, `calibration`, `expected_calibration_error`) **plus** the 8 grounding keys
(`grounding_similarity_mean`, `_median`, `citation_coverage`, `citation_validity_rate`,
`hallucinated_citation_rate`, `grounding_by_category`, `grounding_by_prompt_version`, `no_grounding_count`),
`by_model` rows (minimum set: `grounding_similarity_mean`, `citation_coverage`, `citation_validity_rate`,
`hallucinated_citation_rate` + the validation-derived fields), and `note`. With **zero** validations the payload
carries `message` + all 8 grounding keys (validation fields `null`, `by_model` rows `null`-valued). Grounding is
computed over **all current analyses in scope**; `?model=` narrows it (R5F). Every one of these values can be
`null`, and `grounding_by_category`/`_by_prompt_version` can be `{}` — render `—`, never `0`/`NaN`/blank.

**`GET /api/validations/{id}`** → `llm` contains the 6 R4 keys. Live shapes:

```jsonc
llm.grounding_similarity = 0.5679                       // float | null
llm.references = [ { "page": 133, "quote": "…", "valid": true,
                     "chunk_id": "b78ec80f-…", "document_id": "a7130a32-…",
                     "similarity": 0.5467437054974594, "reason_if_invalid": null } ]
llm.what_should_be_learned = [ { "topik": "Hukum Kedua Termodinamika", "sumber_chunk_ids": ["b78ec80f-…"] } ]
llm.suggested_materials    = same list as what_should_be_learned
llm.grounding_payload      = { "grounding": { "citation_count": 2, "similarity_max": 0.5769…, "similarity_mean": 0.5678… },
                               "references": [ … ] }
```

An ungrounded analysis returns `references: []`, `what_should_be_learned: []`, `grounding_similarity: null`,
`suggested_materials: []` — **every new block needs an empty state** ("Tidak ada sumber referensi terverifikasi
untuk analisis ini."), not a blank panel.

**Frontend facts:** `apiFetch(endpoint, options)` (`app/lib/api.ts`) already sets `Bearer` and leaves
`Content-Type` alone for `FormData` — use `apiFetch("/materials", { method: "POST", body: formData })`.
**Do not reuse `uploadFile` from `app/lib/upload.ts`** (image-only, posts to `/api/uploads`, returns `data.url`).
Subject list for both pages: `GET /api/dashboard/summary` → `my_subjects: [{id, slug, name, image_url}]`, exactly as
`app/questions/page.tsx:88–96` does. Topic picker on `/materials`: `GET /api/admin/subjects/<subject_id>/topics`
(lecturer-accessible, `views.py:964`) — list **only the selected subject's** topics, or omit the picker entirely;
never post a topic from another subject.
`next.config.ts` rewrites `/api/*` and `/media/*` to `BACKEND_URL` (default `http://localhost:8000`).

**Design system — reuse, do not invent:** `PageContainer` (`max-w-7xl`) + `PageHeader` (`{title, description, icon,
eyebrow, action}`), `glass-panel overflow-hidden rounded-xl border border-outline-variant/40`, section headers
`border-b border-outline-variant/40 bg-surface-container-low px-5 py-3`, labels
`text-xs font-bold uppercase tracking-wider text-on-surface-variant`, `text-on-surface`/`text-primary`/
`text-error`, existing badge/button classes, `lucide-react` icons, Indonesian copy, `font-mono-ui` for numbers.
Existing section markers in `validation/[id]/page.tsx`: answer block `367–488`, AI modular block `491–576`,
validation form `581–783` — insert the two new blocks **between `:576` and `:581`**, so the lecturer reads the AI's
sources before deciding.

## Deliverables

**1. `document_title` on citation references** (owner decision 2026-10-12)
In `_grounding_detail` (`validation_views.py:55`), each entry of `references` gains
`"document_title": <knowledge_documents.title>` resolved from its `document_id` — one extra query for the whole
list (`WHERE id = ANY(%s)`), never one query per citation, and **no extra query when the list is empty**.
Null-safe: a malformed/missing `document_id` yields `"document_title": null`, and the key must be present on every
entry so the UI never has to guess. Keep every existing key and value byte-identical. Test: mapping incl. a
malformed entry and an unknown id → `null`.

**2. `frontend/app/materials/page.tsx`** — subject-scoped upload / list / delete
Subject selector (from `my_subjects`); list rows showing title, `ingest_status` (badge: READY ok / PENDING info /
FAILED error **with `ingest_error` shown**), `chunk_count`, `created_at`, `file_name`; upload control enforcing the
same 25 MB + extension rules client-side; delete with a confirm step (`ConfirmDialog` exists); a visible hint that
PENDING documents are drained by `manage.py ingest_materials --pending`; a refresh action. Empty and error states
required (no materials yet / upload failed with the server message).

**3. `frontend/app/metrics/page.tsx`** — the page that makes the endpoint visible
Subject selector + optional model selector; validation-derived panel (tier agreement, macro-F1, MAE/RMSE, ECE,
rejection rate, scored/total); `by_model` comparison table; **grounding panel** (mean, median, coverage, validity
rate, hallucinated rate, `no_grounding_count`, per-category and per-prompt-version breakdowns); the API `note` text
shown verbatim; the `message` shown when there are no validations. Nulls as `—`. **The grounding score is labelled
"keselarasan dengan sumber", never "akurasi"** (brief §13.5) and must not be rendered as a percentage-styled
accuracy badge.

**4. `validation/[id]/page.tsx`** — the lecturer's view of the AI's basis
- **"Sumber Referensi"**: one card per citation with `document_title` + page + the `quote`, and the citation
  similarity; `valid: false` entries get a prominent warning style plus `reason_if_invalid`; note explicitly that
  unverified citations are recorded but not counted.
- **"Yang Perlu Dipelajari"**: the `what_should_be_learned` list (`topik`; `sumber_chunk_ids` may be rendered as
  short ids or omitted, but must not be rendered as raw UUID walls).
- **Grounding score**: `grounding_similarity` with the caveat "bukan akurasi; mengukur keselarasan dengan sumber".
- The `concept_breakdown_json` confirm/deny list keeps working (R4 fixed the key this reads).

**5. Shared types + navigation**
Move/declare the citation + learning-list shapes in `app/lib/studentSubmissions.ts` and import them in the
validation page's local `llm` type instead of re-declaring (R7's student surface inherits them).
`AppSidebar.tsx` `MENU_ITEMS`: "Materi Referensi" → `/materials` (ADMIN + LECTURER) and "Metrik Model" →
`/metrics` (ADMIN + LECTURER), matching the existing entry shape and using existing lucide icons.

## Hard rules

1. Never present grounding similarity as accuracy — no "akurasi" label, no accuracy-styled badge/percentage, in any
   copy or aria text (brief §13.5).
2. Brief §13 verbatim: no `makemigrations`, no `V2_Full_Script.sql`, no re-embedding at analysis time, retrieval
   failure never fails an analysis, never count invented citations, no `EMBEDDINGS_DIMENSIONS` change, do not reuse
   `MediaUploadView`/`uploadFile`, no student-surface work (R7), no secrets.
3. **The browser pass is read-only for the validation flow**: do not accept/edit/reject any analysis, do not call
   `POST /api/validations/{id}/submit`. The only writes allowed are the `/materials` upload you then delete through
   the UI.
4. Do not create subjects/topics/questions/submissions for this phase — use the existing Physics documents and the
   existing analyses. Do not delete or "clean up" the pre-existing rows (the `corrupt` FAILED doc, `r5_sample2`, the
   Chemistry subject) — they are another party's audit fixtures.
5. Do not rename API keys or tighten the frozen shapes; do not "fix" nullable fields into defaults.
6. Keep the validation page's existing behaviour and layout: the confirm/deny interactions, the validation form and
   the tier/percentage logic stay as they are.

## Out of scope (reported by the audit; do NOT fix here)

F2 cross-subject `topic_id` on the API (the UI picker must simply not offer foreign topics); F3 `by_model` row set
comes from validations in the non-empty branch (the page must tolerate the nulls it produces); F5 `.markdown` in the
server allow-list; F6 no retry for a `FAILED` document that already inserted chunks; re-ingest/`--replace` UI;
pre-validation quality gate; export (P7); seeding `prompt_templates`.

## Environment

- Backend: `manage.py` from `backend/` with `set -a && . ../../../scripts/env_local.sh && set +a`. A backend on
  `:8000` may already be running with autoreload ON — do not kill it. Header is `Authorization: Bearer <token>`;
  login `POST /api/auth/login` `{"email":"lecturer@acm.local","password":"demo12345"}` (never print the token).
- DB: `docker exec misconception_db psql -U postgres -d misconception_system -tAc "…"`.
- Frontend must be a **prod build**: `npm run build` then `npm run start -- -p 3002` with
  `BACKEND_URL=http://localhost:8000`. **Stop the dev server on `:3001` first** — two servers exhaust this 16 GB box.
- Browser pass: headless Edge on CDP port `9223` (`msedge.exe --headless=new --remote-debugging-port=9223
  --user-data-dir=D:/edge_profile --no-first-run --window-size=1440,900 about:blank`), driving the helpers at
  `D:/pg_acm/` (`cdp_session.py`, `ui_common.py` — `BASE = http://127.0.0.1:3002`, `shot()`, `js()`, `click_text()`,
  `wait_text()`, `body_text()`), then login as the demo lecturer and `pick_role('Dosen')`. Do not use HMR.

## Verification — run all and paste the RAW output

1. `venv/Scripts/python.exe manage.py check`; `venv/Scripts/python.exe manage.py test api.tests_reference_materials -v 2`
   (existing 34 + your new ones, all green).
2. `curl` the detail endpoint for `1c1d7bf2-b447-4e92-a430-d0cbb6df5c3b` → every citation carries
   `document_title`, and the value for its two citations is `Sears & Salinger — Thermodynamics`. Paste the
   reference array. Then paste the same for an ungrounded analysis (`27ea05a6-ff6b-4e12-aaab-47af47475894`):
   `references: []`, `what_should_be_learned: []`, `grounding_similarity: null`.
   **Evidence rule: grounding assertions come only from PDF-anchored analyses** — those whose citations resolve into
   the `Sears%` document (`1c1d7bf2…` 0.5679 and `8a0f0dc2…` 0.5252; mean = median 0.5465). Do **not** assert on
   `eda8f335-d4af-406a-9b54-fba77f84bbcf` (its 0.8620 comes from citing the ad-hoc `r5_sample2` upload, not the
   textbook) or on the Chemistry analysis.
3. `npm run build` → paste the tail (no TypeScript/ESLint error; note the route list must include `/materials` and
   `/metrics`). Then paste the `next start` boot line for `:3002`.
4. **Browser pass** — paste the printed assertion lines per step plus each screenshot path, and state the console
   output is clean:
   - `/materials`: selector shows Physics, the list shows the 3 existing documents (Sears READY 329 chunks,
     `corrupt` FAILED with its error, `r5_sample2` READY 1 chunk); upload a small `.md` → the row appears PENDING;
     run `manage.py ingest_materials --pending` once → refresh → the same row reads READY with `chunk_count ≥ 1`;
     then delete that row through the UI → it disappears from the list and
     `SELECT count(*) FROM knowledge_documents WHERE title = '<your title>';` is `0`. The document count must be back
     to 3 when you finish.
   - `/metrics`: pooled view renders the validation panel, the `by_model` table, the grounding panel and the `note`;
     switch to the Chemistry subject → the zero-validations state (`message`, all grounding values `—`, no `0`/`NaN`);
     a text assertion proving the string `akurasi` never appears next to the grounding score.
   - `/validation/1c1d7bf2-b447-4e92-a430-d0cbb6df5c3b`: "Sumber Referensi" renders 2 citations with the document
     title, page and quote, and "Yang Perlu Dipelajari" renders the topic; the grounding score shows its caveat.
     Then `/validation/27ea05a6-ff6b-4e12-aaab-47af47475894`: both blocks show their empty-state message.
   - Regression: `/dashboard` and `/validation` still load, and the confirm/deny list on the detail page still
     populates (that is the R4 bug fix — it must not regress).
5. `git diff --name-only HEAD` → only the seven files in the table above. Paste `git log --oneline -3`.

## Finish

Commit in this order:

```
feat(api): document_title on grounding citation references
feat(ui): R6 lecturer materials, metrics and citation surfaces
```

Report back: files changed, raw output for items 1–5, the screenshots' paths, `git log --oneline -3`, and one line
confirming the document count is back to 3. **Do not start R7.**
