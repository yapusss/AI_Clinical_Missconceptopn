# R5F TASK — `?model=` must restrict the grounding block (R5 defect fix)

You are fixing **one defect in committed R5** (`d5dec9e` + `2594938`). Not a feature phase: no new endpoints,
no schema, no docs, no frontend, no phase R6 work.

Authoritative spec for the block's semantics: `docs/R5_TASK.md` item 1, `docs/REFERENCE_MATERIALS_IMPLEMENTATION_BRIEF.md`
§9, and `ModelMetricsView`'s own docstring.

## The defect (reproduced by the owner's audit, live)

`ModelMetricsView.get` builds the grounding block from
`analyses = list(_scope_analyses(request.user, subject_id))` (`validation_views.py:719`), which ignores
`model_filter`. `_zero_validation_payload` only echoes that filter back (`:673`). So `?model=` no longer restricts
the grounding block, though the docstring still promises "restrict the WHOLE payload to one model_identifier"
(`:696`) and R4's implementation did restrict it (there, grounding came from the already model-filtered validations).

Measured before the fix, with the real dev DB:

```
GET /api/metrics/model?model=openai/does-not-exist
  total_validations 0
  grounding_similarity_mean 0.6517      <- pooled over every analysis, not the filtered model
  citation_coverage 0.5
  no_grounding_count 3
  by_model [ {model_identifier: "openai/gpt-oss-20b", ...} ]   <- a row for a model that is NOT the filter
```

Latent only because one `model_identifier` exists today (`model_identifier = settings.LLM_MODEL`, currently
`openai/gpt-oss-20b`). It goes live the moment a run happens under another provider/model — exactly the case the
brief anticipates ("providers grade differently, so pooled numbers can mislead") — and R6's `/metrics` page is the
consumer. Expected behaviour after the fix: a `?model=` that matches nothing yields the
**zero-analyses shape** (see verification item 3), never pooled numbers.

## Deliverables

### 1. Apply the model filter to the grounding analyses (both branches)

- Make the scope helper model-aware: `_scope_analyses(user, subject_id=None, model_filter=None)`
  (`validation_views.py:614`) must add `model_identifier=model_filter` when the filter is given.
- Pass `model_filter` from `ModelMetricsView.get` where the helper is called (`:719`), so **both** the normal
  branch and the zero-validations branch (`:723`) receive already-filtered analyses, and `by_model` in the
  zero-validations branch can no longer list a model other than the requested one.
- Do not weaken the item-1 contract from `docs/R5_TASK.md`: grounding still comes from **all current analyses in
  the queried scope** (lecturer subject scope + `?subject_id=` + now `?model=`), never from the validations.
- Keep every key name, the 4dp rounding, the bucket convention (`grounded only`), and the `note` text.
- No behavioural change when `?model=` is absent: the unfiltered payload must be byte-identical to R5's.

### 2. A DB-free test for the filter

Add a pure helper so the filter is testable without a database (the repo's test runner cannot create the unmanaged
V2 tables — see `docs/HANDOFF.md`), e.g.

```python
def _filter_analyses_by_model(analyses, model_filter):
    if not model_filter:
        return list(analyses)
    return [a for a in analyses if a.model_identifier == model_filter]
```

and use it in the view (or an equivalent that gives the same guarantee). Tests, in
`backend/api/tests_reference_materials.py`, `SimpleTestCase` only:

1. no filter → every analysis kept;
2. matching filter → only that model's analyses kept;
3. non-matching filter → empty list, and `_zero_validation_payload([], model_filter)` then returns the
   zero-analyses shape: the 8 grounding keys with `None` (`no_grounding_count == 0`, buckets `{}`) and
   `by_model == []`.

## THE EVIDENCE RULE — PDF-anchored analyses only

Every grounding assertion in your report must be computed over analyses **grounded in the ingested PDF**:
current analyses whose `grounding_payload_json->'references'` resolve to chunks of a document whose
`title LIKE 'Sears%'`. Use exactly these two, which are today's whole PDF-anchored set:

| analysis id | grounding_similarity | citations | validations |
|---|---|---|---|
| `8a0f0dc2-6d4a-482d-b657-2108f9b7ed1d` | 0.5252 | 2 | 1 |
| `1c1d7bf2-b447-4e92-a430-d0cbb6df5c3b` | 0.5679 | 2 | 1 |

Select them with your own SQL and paste it plus its output:

```sql
SELECT la.id, la.grounding_similarity, la.grounding_citation_count
FROM llm_analyses la
WHERE la.is_current
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(la.grounding_payload_json->'references','[]'::jsonb)) r
    JOIN knowledge_chunks kc ON kc.id::text = r->>'chunk_id'
    JOIN knowledge_documents kd ON kd.id = kc.document_id
    WHERE kd.title LIKE 'Sears%');
```

**Explicitly NOT evidence, and not to be "fixed" or deleted** (they are another party's audit data — leave every
row alone):

- `eda8f335-d4af-406a-9b54-fba77f84bbcf` (Physics, `grounding_similarity` 0.8620): its citations resolve to
  `r5_sample2`, an ad-hoc `.md` upload, **not** the PDF. It is not PDF-anchored, so it must not appear in any
  grounding assertion you make.
- The Chemistry subject `0b000000-0000-0000-0000-000000000030` and its analysis, and every ungrounded analysis.
- Anything you would have to create to make a number line up. **Do not create data for this patch**: no new
  submissions, no new `ingest_materials` runs, no new subjects/topics/role grants, no new uploads. The fix and all
  three verification items are provable with the rows that already exist.

If an expected value can only be reached by including a non-PDF analysis, stop and report it — do not widen the
scope.

## Out of scope (reported by the audit; do NOT fix here)

- Cross-subject `topic_id` accepted by `POST /api/materials` (a Physics document accepted a Biology topic).
- `by_model` row set asymmetry between the two branches (row set from validations when they exist, from analyses
  when they do not) — it resolves when the analyses become the row source in both branches, and is unobservable
  with a single model identifier.
- `.markdown` in the upload allow-list; orphan chunks after a mid-insert failure; per-failure tracebacks.

## Environment

- DB `misconception_db` @ `127.0.0.1:5433` (`docker exec misconception_db psql -U postgres -d misconception_system -tAc "…"`).
- `set -a && . ../../../scripts/env_local.sh && set +a` from `backend/`.
- Header is `Authorization: Bearer <token>`; login `POST /api/auth/login`
  `{"email":"lecturer@acm.local","password":"demo12345"}`. Never print the token.
- A backend on `:8000` may already be running with autoreload ON — do not kill it; if the port is busy use
  `127.0.0.1:8001` and say so.
- Physics subject id `cfc7f58c-eeb8-451e-95e7-14c721e9574b`.

## Verification — run all and paste the RAW output

1. `venv/Scripts/python.exe manage.py check`; `venv/Scripts/python.exe manage.py test api.tests_reference_materials -v 2` (all green; 31 existing tests must stay green).
2. **PDF-only block, helper level.** From `manage.py shell`, call `_grounding_metrics([...])` with exactly the two
   PDF-anchored analyses and paste the block. Required: `grounding_similarity_mean == 0.5465`,
   `grounding_similarity_median == 0.5465`, `citation_coverage == 1.0`, `citation_validity_rate == 1.0`,
   `hallucinated_citation_rate == 0.0`, `no_grounding_count == 0`,
   `grounding_by_prompt_version == {'four-tier-v2.9-rag': {'count': 2, 'similarity_mean': 0.5465}}`.
3. **The fix.** Paste all four payloads:
   - `GET /api/metrics/model?model=openai/does-not-exist` → must be the zero-analyses shape:
     `total_validations 0`, `grounding_similarity_mean`/`_median`/`citation_coverage`/`citation_validity_rate`/
     `hallucinated_citation_rate` all `null`, both buckets `{}`, `no_grounding_count 0`, `by_model []`.
     (Before the fix this returned `mean 0.6517, coverage 0.5, no_grounding 3` and a `by_model` row.)
   - `GET /api/metrics/model?subject_id=0b000000-0000-0000-0000-000000000030&model=openai/does-not-exist` →
     the same zero-analyses shape. Measured before the fix this branch leaked the wrong model:
     `citation_coverage 0.0`, `no_grounding_count 1`, and `by_model` listing `openai/gpt-oss-20b` — after the fix
     it must read `citation_coverage null`, `no_grounding_count 0`, `by_model []`.
   - `GET /api/metrics/model?model=openai/gpt-oss-20b` → equals the unfiltered payload apart from the echoed
     `model_filter` key (only one model identifier exists). Paste both and the one-key diff.
   - `GET /api/metrics/model` (unfiltered) → unchanged from R5: `total_validations 4`,
     `grounding_similarity_mean 0.6517`, `citation_coverage 0.5`, `no_grounding_count 3`,
     `by_model` one row for `openai/gpt-oss-20b`.
4. **Scope reconciliation, stated in words.** For `GET /api/metrics/model?subject_id=cfc7f58c-eeb8-451e-95e7-14c721e9574b`
   paste the payload and the SQL listing that subject's current analyses, and state exactly which rows are in the
   denominator and which of them are PDF-anchored: 4 analyses, 3 grounded → `citation_coverage 0.75`,
   `no_grounding_count 1`, `grounding_similarity_mean 0.6517` = mean over the 0.5252 / 0.5679 / 0.8620 rows.
   Say plainly that the 0.8620 row is **not** PDF-anchored and why; it is in the denominator because the item-1
   contract counts every current analysis in scope, which is the intended behaviour, not a defect.

## Finish

Commit exactly:

```
fix(api): model filter restricts the grounding block
```

Report back: the diff summary, raw output for items 1–4, `git log --oneline -2`, and one line confirming no frontend
file, no new data row, and no other finding was touched. **Do not start R6.**
