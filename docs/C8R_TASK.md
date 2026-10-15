# C8R TASK — finish C8: update both audit scripts, rebuild the frontend

**Context: the delegated C8 session was interrupted for inactivity (the second such stall).** Its code
half was recovered, verified and committed as **`01fc0e6`** — do **not** change it.

Authoritative spec: `docs/COSINE_READING_MATERIAL_BRIEF.md` (**revision 3**) §9, §11.11. Original task:
`docs/C8_TASK.md` — read §5 and §6 for the full intent. This file is the remaining scope.

## Already done and committed — do not re-implement, do not modify

`01fc0e6` removed the 8 top-level grounding metric keys, the per-analysis `grounding_similarity` /
`grounding_payload` / `grounding` detail keys, and `student_feedback` / Modul B `reasoning`. Verified by
me on the live API: 33 → 25 top-level keys, `references` preserved, `answer_similarity_*` /
`verdict_shadow` / `reading_material` present, and the 4 historical grounding DB rows byte-identical
(`n=4 mean=0.6185 max=0.8620 sum_citations=8`). **95 tests OK.**

**The DB columns were deliberately retained** (D10). Do not drop or alter any column.

## Remaining work — the two audit scripts, both OUTSIDE the repo

Neither script was updated, so both now describe the pre-C8 API. **Replace assertions; never delete one
just to reach green.** Your edits to these scripts are **not committed** — say so in your report.

### 1. `scripts/r4_audit.py` — currently `fails: 9, passed: 11`

Every failure is a removed key. Replace as follows:

- The 8 top-level grounding-key assertions become assertions on the **new** keys:
  `answer_similarity_t1_mean`, `answer_similarity_t1_median`, `answer_similarity_t3_mean`,
  `answer_similarity_t3_median`, `answer_similarity_coverage`, `no_similarity_count`,
  `verdict_agreement_rate`, `verdict_comparable_count`, `verdict_disagreement_count`,
  `reading_material_counts`.
- The **per-model** assertions (`by_model` carrying `grounding_similarity_mean` / `citation_coverage` /
  `citation_validity_rate`) become the C5F per-model keys: `answer_similarity_t1_mean`,
  `answer_similarity_t3_mean`, `answer_similarity_coverage`, `verdict_agreement_rate`,
  `verdict_comparable_count`.
- The **detail-contract** probes: `grounding_similarity` / `grounding_payload` are gone; assert instead
  that the detail carries `answer_similarity_t1`, `answer_similarity_t3`, `verdict_shadow` and
  `reading_material`, and that **`references` is still present** with a length equal to the stored
  citation count.
- **The PDF-anchored block becomes a RAW-SQL assertion** (the API no longer exposes it, but the columns
  are retained — that is exactly what D10 requires, and it is a stronger test than the HTTP one it
  replaces). Use `docker exec misconception_db psql …` as the other scripts do. Anchor on the historical
  rows: **4 non-NULL `grounding_similarity` rows, mean `0.6185`, max `0.8620`, `sum(grounding_citation_count) = 8`**.
  The previous HTTP assertion's PDF subset (mean = median `0.5465`) must be reconstructed in SQL by
  joining `grounding_payload_json` references through `knowledge_chunks` → `knowledge_documents` and
  filtering to the textbook title, then asserted there.
- Keep the R5F model-filter invariant, rewritten for the new keys: `?model=openai/does-not-exist` must
  return the empty shape (`null`/`0`/`{}`, `by_model []`), never pooled numbers; and
  `?model=<the real identifier>` must equal the unfiltered payload apart from the echoed `model_filter`.
  `?subject_id=<a subject with no analyses>&model=<bogus>` likewise.

**Acceptance: `fails: 0`.**

### 2. `scripts/r6_ui_audit.py` — needs the frontend rebuilt first

- **Rebuild and re-serve the frontend on `:3002`** (`npm run build`), then start it. A stale build makes
  the audit assert against the old UI. Leave it running.
- It asserts `deprecated — digantikan Answer similarity` renders. Those labels are gone with the keys
  they deprecated. **Replace** that assertion with one asserting the **superseded cards are absent** from
  `/metrics` — no `grounding_similarity_mean` / `citation_validity_rate` / `no_grounding_count` rendered,
  and no deprecation label text.
- **Keep every other assertion**, including: the student-page positive path (`READY material renders`,
  `content_md` + `sources` present for 3 questions) and negative path (the SC question gets no material,
  never a placeholder), the `bukan akurasi` check, the reading-material block, the cosine label, the flag
  control, and the `/metrics` new-key rendering.

**Acceptance: `fails: 0`.**

## Live facts

- Backend on `127.0.0.1:8000` (running the C8 code). Docker/DB is up: 8 analyses, 4 with non-NULL
  `grounding_similarity`.
- `generated_reading_materials` 2 rows, both `UNREVIEWED`: `(qv …0004, FN)` **READY** with real generated
  content (2293 chars, 3 sources) and `(qv …0004, MSC)` READY. The FN one renders live on the student page
  for set `…0002` (3 questions); the SC question returns null.
- `submissions` 6 (2 `PENDING_VALIDATION`, 4 `VALIDATED`), 3 questions, 3 question versions.
- The dev DB is the **evidence base**: do not create submissions, analyses, questions, subjects or users.

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- **Do not modify the repo** (`01fc0e6` is final for this release) except if a test you must keep green
  genuinely requires it — if so, say exactly what and why.
- **Do not drop or alter any DB column.**
- Do not create app data to make an assertion pass.
- Replacing an assertion is expected; **deleting** one to reach green is a FAIL.

## Environment

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

Interpreter `backend/venv/Scripts/python.exe`. DB: docker `misconception_db`, `127.0.0.1:5433`.
Frontend `frontend/` (Next.js), prod build served on `:3002`.

## Verification — run all of these and paste the RAW output

1. `manage.py check`
2. `manage.py test api.tests_reference_materials` — **95** green.
3. **`scripts/r4_audit.py`** — paste the full verdict. **Acceptance: `fails: 0`.** Show the new raw-SQL
   PDF-anchored assertion and its output.
4. **`npm run build`** clean; frontend re-served on `:3002`.
5. **`scripts/r6_ui_audit.py`** — paste the full verdict. **Acceptance: `fails: 0`.** Show the new
   "superseded cards absent" assertion.
6. Evidence base intact: `llm_analyses=8`, `PENDING_VALIDATION=2`, `VALIDATED=4`, `questions=3`,
   `generated_reading_materials=2` (both `UNREVIEWED`).
7. The historical grounding rows are still byte-identical (`n=4 mean=0.6185 max=0.8620 sum=8`).

## Finish

**Do not commit anything to the repo** — the code is final at `01fc0e6`. Report back: the two audit
verdicts, the assertions you replaced (by name), anything you could not verify, and confirm the backend
and frontend are left running.
