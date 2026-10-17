"""`manage.py calibrate_catalog` — Step B of the calibration task (measurement only).

Why this exists: both catalogue thresholds (`CATALOG_MATCH_THRESHOLD`,
`CONCEPT_COVERED_THRESHOLD`) were set by guess, and every backfilled row returned
`no_match` (0.533-0.611 against 0.62), so the `matched` branch has never run on
real data. This command makes the distributions visible before anyone touches a
threshold.

It is **read-only and completion-free**:

* embeddings only (one `embed_text` per selected analysis, exactly like the
  worker / `backfill_catalog_match` path);
* zero provider completions;
* zero DB writes — it never calls `backfill_catalog_match`, never inserts an
  analysis, never edits `concept_breakdown_json`.

It reuses the **existing** scoring code path (`api/catalog_mapping.py`) with the
match threshold pinned to 0, so the raw best-concept score and the raw coverage
scores come from exactly the code the product runs — not from a re-implementation.

    python manage.py calibrate_catalog [--latest-validations N] [--analysis-id UUID]

Selection mirrors `backfill_catalog_match`: the most recent N validated analyses,
or explicit `--analysis-id` values when given. Nothing here decides a threshold;
Step C does, from this output plus judgement.
"""

import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from api.catalog_mapping import (
    MAX_MISSING,
    _best_misconception,
    load_topic_concepts,
    narrow_candidates,
    question_version_concept_ids,
    score_catalog_match,
    select_missing_concepts,
    shortlist_concepts,
)
from api.embeddings import cosine, embed_text
from api.llm import load_context
from api.management.commands.backfill_catalog_match import DEFAULT_LATEST_VALIDATIONS

# Step B asks for 0.40 .. 0.75 in 0.025 steps. Built explicitly so the printed
# grid cannot drift from the request.
SWEEP_START = 0.40
SWEEP_STOP = 0.75
SWEEP_STEP = 0.025


def _sweep_values():
    values = []
    steps = round((SWEEP_STOP - SWEEP_START) / SWEEP_STEP)
    for i in range(steps + 1):
        values.append(round(SWEEP_START + i * SWEEP_STEP, 4))
    return values


def _percentile(sorted_values, fraction):
    """Nearest-rank percentile (deterministic, no interpolation)."""
    if not sorted_values:
        return None
    if fraction <= 0:
        return sorted_values[0]
    if fraction >= 1:
        return sorted_values[-1]
    import math
    index = math.ceil(fraction * len(sorted_values)) - 1
    return sorted_values[max(0, min(index, len(sorted_values) - 1))]


class Command(BaseCommand):
    help = (
        'Step B: measure raw catalogue scores for recent analyses (embeddings '
        'only; no completions, no DB writes) and print threshold sweeps.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--latest-validations', type=int, default=DEFAULT_LATEST_VALIDATIONS,
            help=f'number of most recent validated analyses (default {DEFAULT_LATEST_VALIDATIONS})',
        )
        parser.add_argument(
            '--analysis-id', action='append', default=[], metavar='UUID',
            help='measure this analysis instead of the recent selection (repeatable)',
        )

    def handle(self, *args, **options):
        analysis_ids = self._select(options['analysis_id'], options['latest_validations'])
        if not analysis_ids:
            self.stdout.write('No analyses selected; nothing to measure.')
            return

        scores = []  # per-analysis measurement dicts
        for analysis_id in analysis_ids:
            try:
                scores.append(self._measure(analysis_id))
            except Exception as exc:  # noqa: BLE001 — one bad row must not abort
                self.stderr.write(f'  {analysis_id}  FAILED: {type(exc).__name__}: {exc}')

        self._print_per_analysis(scores)
        self._print_category_stats(scores)
        self._print_match_sweep(scores)
        self._print_coverage_sweep(scores)
        self.stdout.write(
            '\nMeasurement only. Do not set a threshold from these numbers alone — '
            'the human/length-asymmetry decision (Step C) comes next.'
        )

    # -- selection ----------------------------------------------------------

    def _select(self, explicit_ids, latest):
        if latest < 1:
            raise CommandError('--latest-validations must be >= 1')
        if explicit_ids:
            seen, selected = set(), []
            for raw in explicit_ids:
                try:
                    analysis_id = str(uuid.UUID(str(raw)))
                except (TypeError, ValueError):
                    raise CommandError(f'invalid --analysis-id: {raw!r}')
                if analysis_id not in seen:
                    seen.add(analysis_id)
                    selected.append(analysis_id)
            return selected
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT v.analysis_id
                FROM validations v
                WHERE v.validated_at IS NOT NULL
                ORDER BY v.validated_at DESC
                LIMIT %s
                """,
                [latest],
            )
            return [str(row[0]) for row in cur.fetchall()]

    # -- per-analysis measurement -------------------------------------------

    def _load_analysis(self, analysis_id):
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT a.submission_id, a.four_tier_category,
                       COALESCE(a.explanation, ''),
                       (a.concept_breakdown_json->'evidence_span') IS NOT NULL AS span_present
                FROM llm_analyses a
                WHERE a.id = %s
                """,
                [analysis_id],
            )
            row = cur.fetchone()
        if not row:
            raise RuntimeError(f'analysis {analysis_id} not found')
        return {
            'submission_id': str(row[0]),
            'category': row[1],
            'explanation': row[2],
            'span_present': bool(row[3]),
        }

    def _measure(self, analysis_id):
        row = self._load_analysis(analysis_id)
        ctx = load_context(row['submission_id'])

        concepts = load_topic_concepts(ctx.topic_id)
        concept_ids = question_version_concept_ids(ctx.question_version_id)
        candidates = narrow_candidates(concepts, concept_ids)

        analysis_text = '\n'.join([
            row['explanation'] or '',
            ctx.tier1_answer or '',
            ctx.tier3_reason or '',
        ])

        result = None
        text_vec = None
        best_misconception = None
        if candidates:
            text_vec = embed_text(analysis_text)
            # The product's own scorer, threshold pinned to 0 so the raw best
            # score is always returned (never swallowed by an abstain).
            result = score_catalog_match(text_vec, candidates, threshold=0.0)
            if result.get('concept_id'):
                winner = next(
                    (c for c in candidates
                     if str(c['concept_id']) == str(result['concept_id'])), None)
                if winner is not None:
                    best_misconception = _best_misconception(
                        text_vec, winner.get('misconceptions') or [])

        # Coverage: identical inputs to the Phase 5 artefact (shortlist against
        # the question's reference vector, then the student-covered test). Kept
        # as full per-threshold lists so one embedding call serves step 4.
        shortlisted = []
        if text_vec is not None and ctx.reference_t1_vec:
            shortlisted = shortlist_concepts(concepts, ctx.reference_t1_vec)

        return {
            'analysis_id': analysis_id,
            'category': row['category'],
            'span_present': row['span_present'],
            'topic_id': ctx.topic_id,
            'n_concepts': len(concepts),
            'n_candidates': len(candidates),
            'score': (result or {}).get('score'),
            'concept_id': (result or {}).get('concept_id'),
            'concept_name': (result or {}).get('concept_name'),
            'candidates': (result or {}).get('candidates') or [],
            'misconception_label': best_misconception.get('label') if best_misconception else None,
            'misconception_score': (
                round(cosine(text_vec, best_misconception['embedding']), 4)
                if best_misconception and best_misconception.get('embedding') else None
            ),
            'shortlisted': shortlisted,
            'text_vec': text_vec,
        }

    # -- report sections ----------------------------------------------------

    def _print_per_analysis(self, scores):
        self.stdout.write('\n=== 1. Per-analysis raw scores (threshold 0) ===')
        header = (
            f'{"analysis_id":36}  {"cat":4} {"span":4} {"topics":>6} {"cand":>4} '
            f'{"best_concept_score":>18}  {"concept_name":28}  miscon_label / score'
        )
        self.stdout.write(header)
        for m in scores:
            score = 'none' if m['score'] is None else f'{m["score"]:.4f}'
            name = (m['concept_name'] or '-')[:28]
            misc = m['misconception_label'] or '-'
            misc_score = ('none' if m['misconception_score'] is None
                          else f'{m["misconception_score"]:.4f}')
            self.stdout.write(
                f'{m["analysis_id"]:36}  {str(m["category"]):4} '
                f'{"yes" if m["span_present"] else "no":4} '
                f'{m["n_concepts"]:>6} {m["n_candidates"]:>4} {score:>18}  '
                f'{name:28}  {misc} / {misc_score}'
            )
        self.stdout.write(
            '  (topics = embedded concepts on the analysis topic; cand = after D5 narrowing; '
            'span = accepted evidence span exists)'
        )
        # Top-3 concept candidates, for context on the no_match rows.
        for m in scores:
            if m['candidates']:
                shown = ', '.join(
                    f'{c["concept_id"][:8]}={c["score"]:.4f}' for c in m['candidates'])
                self.stdout.write(f'    {m["analysis_id"][:8]} runner-ups: {shown}')

    def _print_category_stats(self, scores):
        self.stdout.write('\n=== 2. Best-concept score by category (min / p50 / p90 / max) ===')
        by_cat = {}
        for m in scores:
            if m['score'] is None:
                continue
            by_cat.setdefault(m['category'], []).append(m['score'])
        if not by_cat:
            self.stdout.write('  (no analysis produced a best-concept score)')
        for cat in sorted(by_cat):
            values = sorted(by_cat[cat])
            count = len(values)
            self.stdout.write(
                f'  {cat:4} n={count:<2} min={values[0]:.4f} '
                f'p50={_percentile(values, 0.50):.4f} '
                f'p90={_percentile(values, 0.90):.4f} max={values[-1]:.4f}'
            )

    def _print_match_sweep(self, scores):
        self.stdout.write('\n=== 3. CATALOG_MATCH_THRESHOLD sweep (0.40 -> 0.75, 0.025) ===')
        self.stdout.write('  threshold   matched   no_match   (of scored rows)')
        decision_scores = [m['score'] for m in scores if m['score'] is not None]
        self.stdout.write(f'  scored rows: {len(decision_scores)} / {len(scores)} selected')
        for t in _sweep_values():
            matched = sum(1 for s in decision_scores if s >= t)
            no_match = len(decision_scores) - matched
            self.stdout.write(f'  {t:9.3f}   {matched:>7}   {no_match:>8}')

    def _print_coverage_sweep(self, scores):
        self.stdout.write(
            '\n=== 4. CONCEPT_COVERED_THRESHOLD sweep (0.40 -> 0.75, 0.025) ===')
        self.stdout.write(
            '  threshold   analyses_scored   flagged_concepts   avg_list_len   lists_at_cap(3)')
        checkable = [m for m in scores if m['text_vec'] is not None and m['shortlisted']]
        if not checkable:
            self.stdout.write('  (no analysis had both a text vector and a shortlist)')
            return
        for t in _sweep_values():
            total_flagged = 0
            capped = 0
            for m in checkable:
                missing = select_missing_concepts(
                    m['shortlisted'], m['text_vec'], covered_threshold=t)
                total_flagged += len(missing)
                if len(missing) >= MAX_MISSING:
                    capped += 1
            avg = total_flagged / len(checkable)
            self.stdout.write(
                f'  {t:9.3f}   {len(checkable):>14}   {total_flagged:>15}   '
                f'{avg:>11.2f}   {capped:>15}'
            )
