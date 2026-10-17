"""`manage.py backfill_catalog_match` — in-place Phase 4/5 catalogue artefacts.

Analyses written before the catalogue phases (4-5) carry no
`concept_breakdown_json.catalog_match` / `missing_concepts`, so the Phase 6
surfaces render nothing. Re-analysing is not an option: the detail view resolves
`pk=analysis_id, is_current=True`, so a new row would flip the old one's
`is_current` and orphan the validation that points at it (the same reason
`backfill_evidence_spans` exists). This command writes the artefacts **onto the
existing row** instead.

    python manage.py backfill_catalog_match --dry-run [--latest-validations N]
    python manage.py backfill_catalog_match --apply   [--latest-validations N] [--force]

For each selected analysis it rebuilds the exact score input the pipeline used
(`analysis.explanation` + the submission's own Tier 1 / Tier 3 text) and
delegates to the same `api.catalog_mapping.build_catalog_artefacts` the worker
calls — **one embedding call per analysis**, embedding-only, no provider
completion. The result is merged into `concept_breakdown_json` in place:

* `catalog_match` is always written;
* `missing_concepts` only when the accepted evidence span is absent **and**
  `four_tier_category != 'SC'` (the same precedence rule as the pipeline).

The command never inserts an analysis, never calls `sp_record_llm_analysis`, and
never touches `prompt_version`, `is_current`, `run_number`, `validations` or any
other column. A row that already carries `catalog_match` is skipped unless
`--force`. Failures are per-row and non-fatal.
"""

import json
import logging
import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from api.catalog_mapping import build_catalog_artefacts
from api.llm import get_active_model_identifier, load_context
from api.management.commands.backfill_evidence_spans import _as_dict

logger = logging.getLogger(__name__)

DEFAULT_LATEST_VALIDATIONS = 6


# ---------------------------------------------------------------------------
# Pure merge (no DB, no network)
# ---------------------------------------------------------------------------

def merge_catalog_artefacts(concept_breakdown, catalog_match, missing_concepts=(),
                            *, category=None, write_missing=False, force=False):
    """Pure jsonb merge: copy `concept_breakdown` and set the Phase 4/5 artefacts.

    Every other key of the dict is preserved unchanged and the input is never
    mutated; the copy is shallow by design (the caller only adds new top-level
    keys, so sharing the untouched nested objects is safe).

    `catalog_match` is always written. `missing_concepts` is written only when
    `write_missing` is true **and** `category != 'SC'` — the same guard the
    pipeline applies, kept here too so a "concepts you missed" list can never be
    stored for a fully correct, confident student. A non-empty list handed in for
    `SC` is refused (silently dropped), never stored.

    Returns `None` when the row already carries `catalog_match` and `force` is
    false: the merge is idempotent, so a re-run (or a resume after a partial
    batch) is a no-op rather than a rewrite.
    """
    if not isinstance(concept_breakdown, dict):
        raise TypeError('concept_breakdown must be a dict')

    if not force and 'catalog_match' in concept_breakdown:
        return None

    merged = dict(concept_breakdown)
    merged['catalog_match'] = catalog_match
    if write_missing and category != 'SC':
        merged['missing_concepts'] = list(missing_concepts or [])
    return merged


class Command(BaseCommand):
    help = (
        'Backfill catalog_match / missing_concepts in place for the most recent '
        'validations (no new analysis rows, no re-analysis).'
    )

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group(required=True)
        mode.add_argument(
            '--dry-run', action='store_true',
            help='print the plan (selected rows + current artefact state); write nothing',
        )
        mode.add_argument(
            '--apply', action='store_true',
            help='perform the backfill (one embedding call per selected analysis)',
        )
        parser.add_argument(
            '--latest-validations', type=int, default=DEFAULT_LATEST_VALIDATIONS,
            help='number of most recent validations to select '
                 f'(default {DEFAULT_LATEST_VALIDATIONS})',
        )
        parser.add_argument(
            '--analysis-id', action='append', default=[], metavar='UUID',
            help='backfill this analysis instead of the recent-validations selection '
                 '(repeatable; --latest-validations is ignored)',
        )
        parser.add_argument(
            '--force', action='store_true',
            help='recompute a row that already carries catalog_match',
        )

    def handle(self, *args, **options):
        apply = options['apply']
        force = options['force']
        latest = options['latest_validations']
        explicit_ids = options['analysis_id']

        if latest < 1:
            raise CommandError('--latest-validations must be >= 1')

        analysis_ids = self._select(explicit_ids, latest)
        if not analysis_ids:
            self.stdout.write('No analyses selected; nothing to do.')
            return

        mode = 'APPLY' if apply else 'DRY-RUN'
        self.stdout.write(
            f'[{mode}] {len(analysis_ids)} analysis row(s) selected '
            f'(model={get_active_model_identifier()}, force={force})'
        )

        matched = no_match = missing_written = skipped = failed = 0
        would_backfill = would_overwrite = 0

        for analysis_id in analysis_ids:
            try:
                outcome, wrote_missing = self._process_one(
                    analysis_id, apply=apply, force=force)
            except Exception as exc:  # noqa: BLE001 — a bad row must not abort the batch
                failed += 1
                logger.exception('catalogue backfill failed for %s', analysis_id)
                self.stderr.write(f'  {analysis_id}  FAILED: {exc}')
                continue

            if outcome == 'matched':
                matched += 1
            elif outcome == 'no_match':
                no_match += 1
            elif outcome == 'skipped':
                skipped += 1
            elif outcome == 'would_backfill':
                would_backfill += 1
            elif outcome == 'would_overwrite':
                would_overwrite += 1
            else:  # pragma: no cover — only the branches above are returned
                failed += 1
            if wrote_missing:
                missing_written += 1

        if apply:
            self.stdout.write(
                f'Done: matched={matched} no_match={no_match} '
                f'missing_written={missing_written} skipped={skipped} '
                f'failed={failed} selected={len(analysis_ids)}'
            )
        else:
            self.stdout.write(
                f'Done: would_backfill={would_backfill} '
                f'would_overwrite={would_overwrite} skipped={skipped} '
                f'failed={failed} selected={len(analysis_ids)}'
            )

    # -- selection ----------------------------------------------------------

    def _select(self, explicit_ids, latest):
        if explicit_ids:
            seen = set()
            selected = []
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

    def _load_analysis(self, analysis_id):
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT a.submission_id, a.four_tier_category,
                       COALESCE(a.explanation, ''),
                       a.concept_breakdown_json,
                       a.concept_breakdown_json ? 'catalog_match' AS has_key,
                       a.concept_breakdown_json->'evidence_span' AS span
                FROM llm_analyses a
                WHERE a.id = %s
                """,
                [analysis_id],
            )
            row = cur.fetchone()
        if not row:
            return None
        return {
            'submission_id': str(row[0]),
            'category': row[1],
            'explanation': row[2],
            'concept_breakdown': _as_dict(row[3]),
            'has_key': bool(row[4]),
            'span_present': bool(_as_dict(row[5])),
        }

    # -- per-row work -------------------------------------------------------

    def _process_one(self, analysis_id, *, apply, force):
        row = self._load_analysis(analysis_id)
        if row is None:
            raise RuntimeError(f'analysis {analysis_id} not found')

        category = row['category']
        label = (
            f"  {analysis_id}  category={category} "
            f"span={'yes' if row['span_present'] else 'no'}"
        )

        if row['has_key'] and not force:
            self.stdout.write(f'{label}  -> SKIP (already has catalog_match)')
            return 'skipped', False

        # The missing list is written only when the accepted span is absent and
        # the category is not SC — the same gate the analysis pipeline applies.
        write_missing = (not row['span_present']) and category != 'SC'

        if not apply:
            if row['has_key']:
                self.stdout.write(f'{label}  -> WOULD OVERWRITE (--force)')
                return 'would_overwrite', False
            self.stdout.write(
                f'{label}  -> WOULD BACKFILL (missing={"yes" if write_missing else "no"})')
            return 'would_backfill', False

        # Rebuild the exact analysis text the pipeline scored, then delegate to
        # the same helper: one `embed_text` call, both artefacts.
        ctx = load_context(row['submission_id'])
        analysis_text = '\n'.join([
            row['explanation'] or '',
            ctx.tier1_answer or '',
            ctx.tier3_reason or '',
        ])
        catalog_match, missing, _vec = build_catalog_artefacts(
            analysis_text=analysis_text,
            topic_id=ctx.topic_id,
            question_version_id=ctx.question_version_id,
            reference_vec=ctx.reference_t1_vec,
            allow_missing=write_missing,
        )

        merged = merge_catalog_artefacts(
            row['concept_breakdown'], catalog_match, missing,
            category=category, write_missing=write_missing, force=force,
        )
        if merged is None:  # pragma: no cover — has_key was checked above
            self.stdout.write(f'{label}  -> SKIP (already has catalog_match)')
            return 'skipped', False

        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE llm_analyses
                SET concept_breakdown_json = %s::jsonb
                WHERE id = %s
                """,
                [json.dumps(merged, ensure_ascii=False), analysis_id],
            )
            if cur.rowcount != 1:
                raise RuntimeError(
                    f'expected to update 1 llm_analyses row, updated {cur.rowcount}')

        status = (catalog_match or {}).get('status') or 'no_match'
        self.stdout.write(
            f'{label}  -> {status.upper()} score={(catalog_match or {}).get("score")} '
            f'candidates={len((catalog_match or {}).get("candidates") or [])} '
            f'missing={len(missing)}'
        )
        wrote_missing = write_missing and 'missing_concepts' in merged
        return ('matched' if status == 'matched' else 'no_match'), wrote_missing

