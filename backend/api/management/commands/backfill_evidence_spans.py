"""`manage.py backfill_evidence_spans` — in-place v3.2 evidence-span backfill.

Older analyses predate prompt `four-tier-v3.2-…`, so their
`concept_breakdown_json` has no `evidence_span` and the "Kutipan jawaban
mahasiswa" block renders nothing. Re-analysing is not an option: the detail view
resolves `pk=analysis_id, is_current=True`, so a new row would break the
validation's URL and orphan it. This command writes the span **onto the existing
row** instead.

    python manage.py backfill_evidence_spans --dry-run [--limit N]
    python manage.py backfill_evidence_spans --apply   [--limit N] [--force]

Selection is the `--limit` most recent validations (`validated_at DESC`,
default 6) or the explicit `--analysis-id` rows. Per selected analysis:

1. `api.llm.load_context` supplies the stored `tier1_answer` / `tier3_reason`;
2. the existing `build_evidence_sentences` / `format_numbered_sentences`
   projection is handed to `run_module_b` — the same prompt, the same JSON
   contract, exactly one provider call;
3. `accept_evidence_span` decides whether the returned quote may be stored;
4. the accepted span is merged into `concept_breakdown_json->'evidence_span'`
   with `"source": "backfill-v3.2"`.

The command never inserts an analysis, never calls `sp_record_llm_analysis`,
and never touches `is_current`, `prompt_version`, `run_number`, `validations` or
any other column. A row that already has a span is skipped unless `--force`.
Failures are per-row and non-fatal.
"""

import dataclasses
import json
import logging
import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from api.llm import (
    accept_evidence_span,
    build_evidence_sentences,
    get_active_model_identifier,
    load_context,
    run_module_b,
)

logger = logging.getLogger(__name__)

# Recorded next to the span so a later reader can tell a native v3.2 anchor from
# this in-place addition; the row's `prompt_version` deliberately stays as it was.
BACKFILL_SOURCE = 'backfill-v3.2'
DEFAULT_LIMIT = 6


def merge_evidence_span(concept_breakdown, span, source=BACKFILL_SOURCE):
    """Pure jsonb merge: copy `concept_breakdown` and set its `evidence_span`.

    Every other key is preserved unchanged, the input dict is not mutated, and
    the accepted span is stored verbatim plus its provenance `source`. The copy
    is shallow by design: the caller only adds a new top-level key, so sharing
    the untouched nested objects is safe.
    """
    if not isinstance(concept_breakdown, dict):
        raise TypeError('concept_breakdown must be a dict')
    if not isinstance(span, dict):
        raise TypeError('span must be a dict')

    merged = dict(concept_breakdown)
    stored = dict(span)
    stored['source'] = source
    merged['evidence_span'] = stored
    return merged


def _as_dict(value):
    """Decode a jsonb column read through a raw cursor.

    Django's PostgreSQL backend hands jsonb back as text on a raw cursor, while
    tests and ORM reads hand back a dict. Both shapes must be accepted so the
    merge never mistakes a string for "no data" and drops the other keys.
    """
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


class Command(BaseCommand):
    help = (
        'Backfill evidence_span in place for the most recent validations '
        '(no new analysis rows, no re-analysis).'
    )

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group(required=True)
        mode.add_argument(
            '--dry-run', action='store_true',
            help='print the plan (selected rows + current span state); write nothing',
        )
        mode.add_argument(
            '--apply', action='store_true',
            help='perform the backfill (exactly one Modul B call per selected analysis)',
        )
        parser.add_argument(
            '--limit', type=int, default=DEFAULT_LIMIT,
            help=f'number of most recent validations to select (default {DEFAULT_LIMIT})',
        )
        parser.add_argument(
            '--analysis-id', action='append', default=[], metavar='UUID',
            help='backfill this analysis instead of the recent-validations selection '
                 '(repeatable; --limit is ignored)',
        )
        parser.add_argument(
            '--force', action='store_true',
            help='overwrite a row that already has an evidence_span',
        )

    def handle(self, *args, **options):
        apply = options['apply']
        force = options['force']
        limit = options['limit']
        explicit_ids = options['analysis_id']

        if limit < 1:
            raise CommandError('--limit must be >= 1')

        analysis_ids = self._select(explicit_ids, limit)
        if not analysis_ids:
            self.stdout.write('No analyses selected; nothing to do.')
            return

        model_identifier = get_active_model_identifier()
        mode = 'APPLY' if apply else 'DRY-RUN'
        self.stdout.write(
            f'[{mode}] {len(analysis_ids)} analysis row(s) selected '
            f'(model={model_identifier}, force={force})'
        )

        accepted = rejected = skipped = failed = 0
        would_backfill = would_overwrite = 0
        for analysis_id in analysis_ids:
            try:
                outcome = self._process_one(
                    analysis_id, model_identifier, apply=apply, force=force)
            except Exception as exc:  # noqa: BLE001 — a bad row must not abort the batch
                failed += 1
                logger.exception('evidence-span backfill failed for %s', analysis_id)
                self.stderr.write(f'  {analysis_id}  FAILED: {exc}')
                continue

            if outcome == 'accepted':
                accepted += 1
            elif outcome == 'rejected':
                rejected += 1
            elif outcome == 'skipped':
                skipped += 1
            elif outcome == 'would_backfill':
                would_backfill += 1
            elif outcome == 'would_overwrite':
                would_overwrite += 1
            else:  # pragma: no cover — only the branches above are returned
                failed += 1

        if apply:
            self.stdout.write(
                f'Done: accepted={accepted} rejected={rejected} '
                f'skipped={skipped} failed={failed} selected={len(analysis_ids)}'
            )
        else:
            self.stdout.write(
                f'Done: would_backfill={would_backfill} '
                f'would_overwrite={would_overwrite} skipped={skipped} '
                f'failed={failed} selected={len(analysis_ids)}'
            )

    # -- selection ----------------------------------------------------------

    def _select(self, explicit_ids, limit):
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
                [limit],
            )
            return [str(row[0]) for row in cur.fetchall()]

    def _load_analysis(self, analysis_id):
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT a.submission_id, a.prompt_version, a.is_current,
                       a.concept_breakdown_json,
                       a.concept_breakdown_json ? 'evidence_span' AS has_key,
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
            'prompt_version': row[1],
            'is_current': row[2],
            'concept_breakdown': _as_dict(row[3]),
            'has_key': bool(row[4]),
            'span': _as_dict(row[5]) or None,
        }

    # -- per-row work -------------------------------------------------------

    def _process_one(self, analysis_id, model_identifier, *, apply, force):
        row = self._load_analysis(analysis_id)
        if row is None:
            raise RuntimeError(f'analysis {analysis_id} not found')

        span = row['span']
        label = (
            f"  {analysis_id}  span_key={str(row['has_key']).lower()} "
            f"prompt={row['prompt_version']} current={str(row['is_current']).lower()}"
        )

        if span and not force:
            self.stdout.write(f'{label}  -> SKIP (already has evidence_span)')
            return 'skipped'

        if not apply:
            if span:
                self.stdout.write(f'{label}  -> WOULD OVERWRITE (--force)')
                return 'would_overwrite'
            self.stdout.write(f'{label}  -> WOULD BACKFILL')
            return 'would_backfill'

        # Pipeline parity: this is the exact context Modul B reads in
        # `analyze_submission` — the flag-driven combined reason included.
        ctx = load_context(row['submission_id'])
        if 't1_berisi_alasan' in ctx.heuristic_flags or 't3_redundan' in ctx.heuristic_flags:
            eval_b_ctx = dataclasses.replace(
                ctx, tier3_reason=f"Jawaban: {ctx.tier1_answer}\nAlasan: {ctx.tier3_reason}")
        else:
            eval_b_ctx = ctx

        sentences = build_evidence_sentences(
            eval_b_ctx.tier1_answer, eval_b_ctx.tier3_reason)
        # Exactly one provider call. `run_module_b` rebuilds the same prompt and
        # returns the raw span alongside its verdict; only the span is used here.
        (_score, _referensi, _what, raw_span) = run_module_b(
            eval_b_ctx, model_identifier, sentences)
        accepted_span = accept_evidence_span(
            raw_span, eval_b_ctx.tier1_answer, eval_b_ctx.tier3_reason, sentences)
        if accepted_span is None:
            # Either the model answered `null` ("no misconception") or the guard
            # refused the quote. Both are normal outcomes, not retryable errors.
            self.stdout.write(f'{label}  -> REJECTED (no span accepted)')
            return 'rejected'

        merged = merge_evidence_span(row['concept_breakdown'], accepted_span)
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

        self.stdout.write(
            f'{label}  -> ACCEPTED id={accepted_span["sentence_id"]} '
            f'field={accepted_span["field"]} status={accepted_span["status"]} '
            f'quote={accepted_span["quote"]!r}'
        )
        return 'accepted'
