"""`manage.py drain_reading_materials` — Phase C4 (D18).

One command, one loop. Per tick it:

1. runs the C2 reference-embedding sweep (a hash compare — change detection,
   not work, so it needs no schedule of its own), then
2. generates a batch of `PENDING`/`STALE` reading material, then sleeps.

Run it next to `manage.py analyze_submissions --loop`. Generation never sits
inside an `ANALYZING` window, so it is safe with respect to that command's
10-minute zombie re-claim.

Flags::

    python manage.py drain_reading_materials [--pending] [--loop] [--refresh]
                                            [--replace] [--question-version <uuid>]
                                            [--limit N]

* `--pending` (default): drain `PENDING`/`STALE` rows once, then exit.
* `--loop`: keep ticking every `POLL_INTERVAL_SECONDS`.
* `--refresh`: additionally recompute each `READY` row's fingerprint and mark it
  `STALE` (so it regenerates) when the inputs differ.
* `--replace`: force regeneration regardless of fingerprint (include `READY`).
* Rows at `READING_MATERIAL_MAX_RUNS` attempts are left `FAILED` and skipped,
  which caps the flag -> regenerate loop (C6).
"""

import logging
import time
import uuid as uuid_lib

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from api.llm import get_active_model_identifier
from api.management.commands.sync_reference_embeddings import sync_reference_embeddings
from api.reading_materials import (
    READING_MATERIAL_PROMPT_VERSION,
    generate_reading_material,
    input_fingerprint,
    load_question_version_context,
)
from api.worker_health import record_heartbeat, supervisor_gone

logger = logging.getLogger(__name__)

# Matches `analyze_submissions.py`'s poll cadence.
POLL_INTERVAL_SECONDS = 5


def _select_work(statuses, max_runs, limit, question_version_id=None):
    sql = """
        SELECT question_version_id, category, status, attempts
        FROM generated_reading_materials
        WHERE status = ANY(%s) AND attempts < %s
    """
    params = [list(statuses), max_runs]
    if question_version_id:
        sql += " AND question_version_id = %s"
        params.append(question_version_id)
    sql += " ORDER BY created_at"
    if limit:
        sql += " LIMIT %s"
        params.append(limit)
    with connection.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def _fail_capped_rows(statuses, max_runs, question_version_id=None):
    """Stop retrying rows that reached the attempt cap (leave them `FAILED`)."""
    sql = """
        UPDATE generated_reading_materials
        SET status = 'FAILED', updated_at = CURRENT_TIMESTAMP
        WHERE status = ANY(%s) AND attempts >= %s
    """
    params = [list(statuses), max_runs]
    if question_version_id:
        sql += " AND question_version_id = %s"
        params.append(question_version_id)
    with connection.cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount


class Command(BaseCommand):
    help = (
        'Drain PENDING/STALE generated reading material: run the C2 reference '
        'sweep, then generate a batch (optionally --loop).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--pending', action='store_true',
            help='Drain PENDING/STALE rows once (default behaviour)',
        )
        parser.add_argument(
            '--loop', action='store_true',
            help='Keep ticking every POLL_INTERVAL_SECONDS seconds',
        )
        parser.add_argument(
            '--refresh', action='store_true',
            help="Recompute each READY row's fingerprint and mark it STALE when it differs",
        )
        parser.add_argument(
            '--replace', action='store_true',
            help='Force regeneration regardless of fingerprint (include READY rows)',
        )
        parser.add_argument(
            '--question-version', dest='question_version', default=None,
            help='Restrict to a single question version (uuid)',
        )
        parser.add_argument(
            '--limit', type=int, default=None,
            help='Cap the material batch size for this tick',
        )

    def handle(self, *args, **options):
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s %(levelname)s %(name)s: %(message)s',
        )

        limit = options['limit']
        if limit is not None and limit < 1:
            raise CommandError('--limit must be >= 1')

        question_version_id = options['question_version']
        if question_version_id:
            try:
                question_version_id = uuid_lib.UUID(str(question_version_id))
            except (ValueError, TypeError, AttributeError):
                raise CommandError(
                    f'--question-version must be a uuid (got {question_version_id!r})'
                )
        options['question_version'] = question_version_id

        while True:
            # Liveness (migration 0029): materials silently piling up as PENDING is
            # how a missing drainer used to look from the outside.
            record_heartbeat(
                'materials',
                {'mode': 'loop' if options['loop'] else 'once', 'limit': limit},
            )
            if supervisor_gone():
                self.stderr.write(
                    '[material] supervisor gone; exiting (a backend restart starts a fresh worker)'
                )
                return
            self._tick(options)
            if not options['loop']:
                break
            time.sleep(POLL_INTERVAL_SECONDS)

    # -- one tick -------------------------------------------------------------

    def _tick(self, options):
        self._run_c2_sync(options['question_version'])

        if options['refresh']:
            marked = self._refresh_ready(options['question_version'])
            self.stdout.write(f'[refresh] {marked} READY row(s) marked STALE')

        self._drain_batch(options)

    def _run_c2_sync(self, question_version_id):
        """The C2 sweep rides every tick: it is change detection, not work."""
        try:
            counts = sync_reference_embeddings(
                question_version_id=question_version_id,
                log=lambda message: self.stdout.write(message),
            )
            self.stdout.write(
                '[sync] '
                f'question_versions={counts["question_versions"]} '
                f'rows_to_embed={counts["rows_to_embed"]} '
                f'rows_embedded={counts["rows_embedded"]} '
                f'rows_skipped={counts["rows_skipped"]}'
            )
        except Exception as e:  # noqa: BLE001 — a sync failure must not stop material
            self.stderr.write(f'[sync] failed (non-fatal): {type(e).__name__}: {e}')

    def _refresh_ready(self, question_version_id):
        sql = (
            "SELECT question_version_id, category, input_fingerprint "
            "FROM generated_reading_materials WHERE status = 'READY'"
        )
        params = []
        if question_version_id:
            sql += ' AND question_version_id = %s'
            params.append(question_version_id)
        with connection.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        model_identifier = get_active_model_identifier()
        ctx_cache = {}
        stale = []
        for qv_id, category, stored in rows:
            key = str(qv_id)
            ctx = ctx_cache.get(key)
            if ctx is None:
                ctx = load_question_version_context(qv_id)
                ctx_cache[key] = ctx
            fingerprint = input_fingerprint(
                READING_MATERIAL_PROMPT_VERSION, model_identifier, qv_id, category,
                ctx.question_prompt, ctx.reference_short_answer, ctx.reference_reason,
            )
            if (stored or '').strip() != fingerprint:
                stale.append((qv_id, category))

        if stale:
            with connection.cursor() as cur:
                for qv_id, category in stale:
                    cur.execute(
                        """
                        UPDATE generated_reading_materials
                        SET status = 'STALE', updated_at = CURRENT_TIMESTAMP
                        WHERE question_version_id = %s AND category = %s
                        """,
                        [qv_id, category],
                    )
        return len(stale)

    def _drain_batch(self, options):
        max_runs = settings.READING_MATERIAL_MAX_RUNS
        statuses = ['PENDING', 'STALE']
        if options['replace']:
            statuses.append('READY')

        capped = _fail_capped_rows(statuses, max_runs, options['question_version'])
        if capped:
            self.stdout.write(
                f'[material] {capped} row(s) reached max runs '
                f'({max_runs}); left FAILED.'
            )

        rows = _select_work(
            statuses, max_runs, options['limit'], options['question_version'],
        )
        if not rows:
            self.stdout.write('[material] Nothing to drain.')
            return 0

        ctx_cache = {}
        generated = 0
        for qv_id, category, _status, _attempts in rows:
            key = str(qv_id)
            ctx = ctx_cache.get(key)
            if ctx is None:
                ctx = load_question_version_context(qv_id)
                ctx_cache[key] = ctx
            result = generate_reading_material(ctx, category)
            generated += 1
            self.stdout.write(f'[material] {qv_id}/{category}: {result}')
        return generated
