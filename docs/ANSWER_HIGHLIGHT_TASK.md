# TASK — student-answer evidence highlight + short misconception material

You are working in `D:/ClinicalAI_Misconception/Code/AI_Clinical_Missconceptopn`
(Django DRF backend + Next.js frontend, PostgreSQL in docker). Read this file and execute
it phase by phase. Every decision below is **locked by the user** — do not redesign, do not
offer alternatives, do not add features that are not listed. One commit per phase, never push.

Repo facts you must not rediscover the hard way:

- Backend: `backend/`, venv at `backend/venv/Scripts/python.exe`, settings come from env:
  ```bash
  cd backend && set -a && . ../../../scripts/env_local.sh >/dev/null 2>&1 && set +a
  ```
  (`../../../scripts/` = `D:/ClinicalAI_Misconception/scripts/`, outside the repo.)
- Tests: **only** `venv/Scripts/python.exe manage.py test api.tests_reference_materials`.
  `manage.py test api` cannot pass here (unmanaged domain tables); never add a `TestCase`,
  never "fix" `api/tests.py`. DB-free `SimpleTestCase` only.
- Postgres: `docker exec misconception_db psql -U postgres -d misconception_system -c "..."`
- Live services: backend `127.0.0.1:8000` (native runserver, supervises two workers),
  prod frontend `:3002` (`next start`). Port `:3001` belongs to another app — never use it.
- Migrations are applied through `0031`. **Do not create a migration for this task: everything
  fits in existing columns.** Two files are numbered `0028` on purpose — never renumber them.
- `PROMPT_VERSION` and `READING_MATERIAL_PROMPT_VERSION` are asserted by
  `backend/api/tests_reference_materials.py` (`assertIn('v3.1', llm.PROMPT_VERSION)` around
  line 143). Bump the constant **and** the test in the same commit.

---

## Phase A — regenerate the 12 existing materials on prompt v1.2 (operational)

Material prompt is already v1.2 (commit `2a66915d`). The version bump only changes each row's
`input_fingerprint`; nothing regenerates by itself.

```bash
cd backend && set -a && . ../../../scripts/env_local.sh >/dev/null 2>&1 && set +a
venv/Scripts/python.exe manage.py drain_reading_materials --refresh
```

Then verify in SQL and paste the raw output into your final report:

```sql
SELECT status, prompt_version, count(*) FROM generated_reading_materials GROUP BY 1,2 ORDER BY 1,2;
SELECT category, length(content_md) AS chars, jsonb_array_length(sources_json) AS srcs
FROM generated_reading_materials ORDER BY chars DESC;
```

Expect: every row `READY`, `prompt_version = 'reading-material-v1.2'`, `chars` ≈ 700–1200
(a couple of outliers are acceptable, report them), `srcs` not collapsing to 0.
If a row ends `FAILED`, report the `ingest_error` — do not silently retry more than
`READING_MATERIAL_MAX_RUNS`.

No commit unless you had to change code (you should not need to).

---

## Phase B — evidence span: LLM contract, acceptance guard, storage (backend)

**Goal.** For every new analysis, the model marks the one statement in the student's own answer
that carries the misconception, so the UI can tint it.

### B1. Sentence-ID contract (no extra LLM call)

`backend/api/llm.py` already sends both answers verbatim into the existing prompts
(`ctx.tier1_answer`, `ctx.tier3_reason`; see the module A/B/C prompt builders around lines
650–780). **Reuse that single call.** Do not add a second call, do not add a new provider
request, do not add a new endpoint.

- Build a plain-text projection of `tier1_answer` and `tier3_reason`: strip HTML tags
  (answers may be TipTap HTML with `<math-field>`), collapse whitespace.
- Split each field into sentences (`.`, `!`, `?`, and newline boundaries are enough;
  keep it simple and deterministic).
- Feed the **numbered** sentences into the prompt in place of the current raw block and
  require this extra top-level field in the existing JSON response contract:

```json
"evidence_span": {
  "field": "tier1" | "tier3",
  "sentence_id": 4,
  "quote": "tidak mengandung hidrogen dan oksigen",
  "reason": "satu kalimat menjelaskan mengapa pernyataan ini menunjukkan miskonsepsi"
}
```

Rules to state in the prompt (Indonesian, matching the surrounding style):
- `sentence_id` MUST be one of the numbers given; pick the ONE sentence that most clearly
  carries the misconception, preferring `tier3` when both are equally indicative.
- `quote` must be copied **exactly** from that sentence, maximum 15 words; it is the smallest
  phrase that shows the error (the "tidak" case).
- If no statement in either field shows a misconception (e.g. category `SC`), return
  `"evidence_span": null`. Never invent a quote.

### B2. Acceptance guard (pure function + tests)

Add a module-level function in `llm.py`, e.g.
`accept_evidence_span(span, tier1_text, tier3_text, sentences) -> dict | None`, which:

1. resolves `sentence_id` → sentence text; unknown id → reject;
2. normalizes both sides: strip tags, collapse whitespace, casefold, normalize curly quotes;
3. requires `quote` to be a substring of the resolved sentence (exact match first, then the
   normalized match). Substring of the *field* but not the sentence → reject;
4. returns `{'field','sentence_id','quote','reason','status'}` with
   `status ∈ {'exact','normalized'}`; on any failure log `evidence_span_rejected` with the
   field and the reason, return `None`.

`status` is required: it is the only way to measure how often the anchor degrades.

### B3. Storage — no migration, no procedure change

`sp_record_llm_analysis` already takes `p_concept_breakdown jsonb` (both the 11-arg and 16-arg
overloads). Put the accepted span inside the `concept_breakdown` dict under key
`evidence_span`, so it lands in `llm_analyses.concept_breakdown_json`. Include `status`.
Do **not** touch `backend/api/migrations/` and do **not** re-create the procedure.

### B4. Prompt version

`PROMPT_VERSION` `four-tier-v3.1-{TIER_VERDICT_SOURCE}` → `four-tier-v3.2-…`, and update the
test assertion in the same commit. Old analyses keep no span — that is accepted.

### B5. Expose it on both surfaces, resolved against the lecturer's category

- `backend/api/validation_views.py: _grounding_detail` (lecturer payload) — include
  `evidence_span` as stored.
- `backend/api/views.py: _student_analysis_detail` (line ~2370) — include the same
  `evidence_span`, and **fix the category authority**: the material lookup currently passes
  `analysis.four_tier_category`. Resolve `Validation.objects.filter(analysis=analysis).first()`
  and pass `lecturer_category(analysis, validation.final_tier_level_snapshot,
  validation.final_category)` when a validation exists, else the AI category.
  If that `(question_version_id, category)` material row does not exist, call the idempotent
  `enqueue_reading_material(...)` and return `{'status': 'PENDING'}` — **never generate
  material inside a web request**.
- Student surface shows `evidence_span` only when the material row is `READY`; lecturer
  surfaces show it always.

### B6. Tests (DB-free `SimpleTestCase`, in `api/tests_reference_materials.py`)

- exact quote accepted, `status='exact'`
- quote differing in whitespace/case/curly quotes accepted, `status='normalized'`
- hallucinated quote rejected → `None`
- unknown `sentence_id` rejected
- empty/blank quote rejected
- sentence splitter keeps a `math-field` LaTeX out of the projection (no `<span` in output)

---

## Phase C — frontend highlight (same payload, both surfaces)

**Rendering decision (locked):** tint the sentence **inside the read-only answer text**;
render the `reason` as one small line directly under that field. No popover, no modal, no
separate "quote block".

- `frontend/app/components/RichTextContent.tsx` gains `highlightQuote?: string`:
  after mount, walk text nodes (skip any `math-field` subtree), build one concatenated string
  with per-node offsets, locate the normalized quote, map the match back to `(node, offset)`
  segments and wrap them in `<mark class="evidence-mark">`. No match → render nothing
  (no mark, and **no reason line either** — never a claim without its location).
- Plain-text fields (Tier 3 when not HTML) get the same treatment without the walker.
- Style in `frontend/app/globals.css`: `.evidence-mark` — background tint only, no padding
  jump, no layout shift; must stay readable in both light and dark if the app themes.
- Wire the surfaces (payload key `evidence_span`):
  - student: `frontend/app/pengumpulan/[packageId]/page.tsx` — gated on
    `reading_material.status === 'READY'`
  - lecturer: `frontend/app/sets/[id]/page.tsx`,
    `frontend/app/validation/[id]/page.tsx`,
    `frontend/app/questions/[id]/students/[studentId]/page.tsx` — ungated

**Verification (required, paste raw output):**
1. `npx tsc --noEmit` clean, `npm run build` clean.
2. Restart the prod server: stop the process listening on `:3002`
   (`powershell -NoProfile -Command "Stop-Process -Id <pid> -Force"`), then start it again with
   `node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3002` — do **not** leave `:3002` down.
3. Submit a fresh answer that contains a negation, wait for the analysis worker, then:
   ```sql
   SELECT prompt_version, concept_breakdown_json->'evidence_span'
   FROM llm_analyses ORDER BY created_at DESC LIMIT 3;
   ```
   and confirm the quote is a real substring of the stored answer.
4. Load the student page and the lecturer page and assert exactly one `evidence-mark`
   element whose text equals the quote. If no browser is available, say so plainly instead
   of claiming success.

---

## Phase D — lecturer decision independence (small, do it last)

`frontend/app/validation/[id]/page.tsx` initialises `finalCategory` from the AI verdict
(`existing?.final_category ?? det.llm.four_tier_category ?? ""`, around lines 208 and 380).
That pre-fills the very decision the screen exists to overrule.

1. When **no** prior validation exists, start `finalCategory` empty and require an explicit
   choice; keep the existing value when the lecturer is editing their own earlier decision.
2. Add the measurement query to the commit message body, not to the UI:
   ```sql
   SELECT original_category, final_category, count(*)
   FROM validations GROUP BY 1,2 ORDER BY 1,2;
   ```
3. Show the AI's `evidence_span` **reason** on the decision screen only after a category is
   chosen (the location/tint may show immediately; the model's causal claim must not lead the
   decision). Read-only review surfaces are unaffected.

---

## Report format

End with: files changed per phase, the raw verification output, SQL results, commit hashes,
and anything you could not verify. Do not claim a browser check you did not run.
