# R4 TASK — grounding metrics + API exposure (`validation_views.py`)

You are implementing **PHASE R4 ONLY** of the reference-materials feature.
Authoritative spec: `docs/REFERENCE_MATERIALS_IMPLEMENTATION_BRIEF.md` — read **§9** (lines 301–317) and
**§10.1** (lines 320–325) first, they are the complete contract. Also §13 (must-not-do list).
Implement R4 and **nothing** from later phases (no frontend changes, no `/materials` page, no student surface).

State you must trust (already verified, do not redo):
- R3 commit `d6f99e2`: the pipeline writes `grounding_similarity`, `grounding_similarity_max`,
  `grounding_citation_count`, `grounding_payload_json` on `llm_analyses` with
  `prompt_version = 'four-tier-v2.9-rag'`. `concept_breakdown_json` now always carries `references`
  (list: `{chunk_id, document_id, page, quote, similarity, valid, reason_if_invalid}`),
  `what_should_be_learned` (list: `{topik, sumber_chunk_ids}`), and
  `grounding: {similarity_mean, similarity_max, citation_count}`. `suggested_materials_json` carries the
  `what_should_be_learned` list. Older analyses (`four-tier-v2.8` and earlier) have NULL grounding columns
  and no such keys — the new metrics keys must tolerate that.
- R2: Sears PDF ingested into Physics subject `cfc7f58c-eeb8-451e-95e7-14c721e9574b` (329 chunks).
- There are already ≥3 `four-tier-v2.9-rag` analyses with non-null grounding in the dev DB to verify against.

## Deliverables (all in `backend/api/validation_views.py` unless stated)

1. **`_compute_metrics` (lines 402–494) — grounding block (brief §9)**
   Compute from the **analysis rows** attached to the validations passed in — these are properties of the
   analysis, NOT of the validation; no lecturer validation is required for them. Use
   `grounding_similarity`, `grounding_similarity_max`, `grounding_citation_count`, `grounding_payload_json`
   from `v.analysis` (the function receives Validation objects with `select_related('analysis')` at lines
   526/534 — keep that, no extra queries per row).
   Add top-level keys (all rounded to 4dp like the existing metrics, `None` where empty):
   - `grounding_similarity_mean` — mean of non-null `grounding_similarity` over analyses present in the aggregation
   - `grounding_similarity_median` — median of the same
   - `citation_coverage` — analyses_with_citation_count>=1 / analyses_total (4dp)
   - `citation_validity_rate` — count of citations with `valid: true` / all citations across
     `grounding_payload_json->references` (4dp; `None` when total citations = 0)
   - `hallucinated_citation_rate` — `1 - citation_validity_rate` (same None rule)
   - `grounding_by_category` — `{four_tier_category: {count, similarity_mean}}`
   - `grounding_by_prompt_version` — `{prompt_version: {count, similarity_mean}}`
   - `no_grounding_count` — analyses_total - analyses_with_any_citations
   Add ALL of these keys — including for every `by_model` row (lines 549–558), add at minimum
   `grounding_similarity_mean`, `citation_coverage`, `citation_validity_rate`.
   **Docstring + doc notes must state these are self-evaluation of advice-source alignment, not accuracy**
   (never present grounding similarity as accuracy — HANDOFF rule 5).
   Extend the payload `note` (line 563): grounding needs no ground truth; it measures whether the cited
   sources actually support the advice.

2. **`ModelMetricsView` docstring (lines 497–511)** — add one line documenting the grounding block and its
   no-ground-truth semantics.

3. **`ValidationDetailView` (lines 165–245) — expose the new data (§10.1)**
   Add to the `llm` dict:
   - `'concept_breakdown_json': breakdown` (the FULL breakdown — this also **fixes a live UI bug**:
     `frontend/app/validation/[id]/page.tsx` reads `det.llm.concept_breakdown_json` but the backend has never
     returned it, so the downstream UI renders empty; fix the key, do NOT touch the frontend file)
   - `'references': breakdown.get('references') or []`
   - `'what_should_be_learned': breakdown.get('what_should_be_learned') or []`
   - `'suggested_materials': a.suggested_materials_json or []`
   - `'grounding': {`'similarity_mean': float(a.grounding_similarity) if
     a.grounding_similarity is not None else None, 'similarity_max': float(a.grounding_similarity_max)
     if a.grounding_similarity_max is not None else None, 'citation_count': a.grounding_citation_count,
     'payload': a.grounding_payload_json or {}`}`
   Old analyses return the same keys with empty/None values — shape must not depend on prompt_version.

4. **Tests — extend `backend/api/tests_reference_materials.py`** (monkeypatched, no shared-DB fixtures):
   - `_compute_metrics` grounding keys from monkeypatched Validation objects: one analysis with 2 valid + 1
     invalid citation and one with 0 citations → expected mean/median/coverage/validity/hallucinated/
     no_grounding_count; assert 4dp rounding and None-when-empty rules.
   - `ValidationDetailView`-shape check: an analysis with NULL grounding yields the same key shape with
     empty/None values (call the response-building logic or the view's helper path; skip if the view requires
     too much DB scaffolding — in that case factor the `llm`-dict grounding/references assembly into a small
     pure helper and test that helper. Do NOT restructure the view beyond what's needed for the helper.)
   Run: `venv/Scripts/python.exe manage.py test api.tests_reference_materials -v 2` — all green,
   existing tests untouched and still passing.

## Live facts to respect

- `_compute_metrics` currently has NO grounding logic; `ModelMetricsView.get` builds `by_model` rows at
  lines 543–558 and `payload['note']` at line 563.
- `ValidationDetailView` currently returns `'misconception_matches': matches` (line 238) where
  `matches = breakdown.get('misconception_matches')` — keep it; `.get` on a dict is already null-safe.
- Validation-scoped metrics must stay consistent: an analysis with no validation contributes NO agreement
  metrics (unchanged logic), but citation metrics are computed over the analyses of the validations in scope.
  Document that denominator choice in a comment.

## Hard rules

- **Never** run `makemigrations`. **Never** re-import `V2_Full_Script.sql`.
- Do not touch any frontend file, `api/llm.py`, `api/embeddings.py`, the ingest command, or urls.
- Never present grounding similarity as accuracy (rule 5) — not in payloads' `note`, not in docstrings.
- No new endpoints; extend the existing two views only. Scoped to this repo.

## Environment

Before **every** `manage.py` call:

```bash
cd /d/ClinicalAI_Misconception && set -a && source scripts/env_local.sh && set +a
```

That file is **outside** this repo. Interpreter: `backend/venv/Scripts/python.exe` (run from `backend/`).
DB: docker `misconception_db` at `127.0.0.1:5433`, db `misconception_system`, user `postgres`;
`psql` via `docker exec misconception_db psql -U postgres -d misconception_system -tAc "..."`.
The API needs a running backend + a lecturer token to curl; the dev stack is usually already up via
docker-compose (backend on :8000). If it is not running, start it the way this repo normally does
(docker-compose.dev.yml) — do not invent a new startup path; if you cannot start it, run the SQL/
ORM-level checks instead and report that the curl verification was skipped.

## Verification — run all and paste the RAW output

1. `venv/Scripts/python.exe manage.py check`
2. `venv/Scripts/python.exe manage.py test api.tests_reference_materials -v 2` (all green)
3. From `manage.py shell`: call `_compute_metrics` over the validations whose analyses are
   `prompt_version='four-tier-v2.9-rag'` in the dev DB and print the full grounding block —
   mean/median must be ~0.5–0.6, coverage > 0, validity 1.0, and the category/prompt-version breakdowns
   must show the `four-tier-v2.9-rag` row.
4. `curl -s http://127.0.0.1:8000/api/metrics/model/ -H "Authorization: Token < YOUR_TOKEN>" | <jq/pretty>`
   → the new keys are present at top level and inside `by_model[0]`. (Use a token you find by asking the
   DB or the dev docs; NEVER commit or print the raw token in the final report — mask it.)
5. `curl` the detail endpoint for the latest Physics analysis id: pick it via
   `SELECT id FROM llm_analyses WHERE prompt_version='four-tier-v2.9-rag' AND grounding_similarity IS NOT NULL
   ORDER BY run_number DESC LIMIT 1;` → response must contain `references` (2 entries), non-empty
   `what_should_be_learned`, `suggested_materials`, and `grounding.similarity_mean ≈ 0.568`.
6. Regression: `curl` the detail endpoint of an OLD (`four-tier-v2.8`) analysis → same key shape,
   `references: []`, `grounding.citation_count: None`.

## Finish

Commit exactly:

```
feat(api): R4 grounding metrics and validation detail exposure
```

Report back: files changed, raw verification output (test run + shell metrics block + the three curls),
commit hash. **Do not start R5.**
