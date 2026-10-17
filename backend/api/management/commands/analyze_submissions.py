"""P4 worker — Django management command.

Polling worker over `idx_submissions_active_queue`:
    python manage.py analyze_submissions            # one pass over the queue
    python manage.py analyze_submissions --loop     # keep polling (daemon)
    python manage.py analyze_submissions --limit 5  # cap per pass

Queue selection:
    SUBMITTED        — never analyzed
    REJECTED         — lecturer rejected; re-run with notes up to LLM_MAX_RUNS
    ANALYSIS_FAILED  — retry, up to LLM_MAX_RUNS per submission

Zombies in ANALYZING > 10 min are marked ANALYSIS_FAILED.
Claims use SELECT ... FOR UPDATE SKIP LOCKED.
"""

import logging
import time
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection
from django.utils import timezone

from api.llm import analyze_submission
from api.worker_health import record_heartbeat, supervisor_gone

logger = logging.getLogger(__name__)

ANALYZING_TIMEOUT_MINUTES = 10
POLL_INTERVAL_SECONDS = 5


class Command(BaseCommand):
    help = 'P4 analysis worker: pick up submissions and run four-tier LLM grading.'

    def add_arguments(self, parser):
        parser.add_argument('--loop', action='store_true', help='keep polling instead of one pass')
        parser.add_argument('--limit', type=int, default=25, help='max submissions per pass')
        parser.add_argument(
            '--interval',
            type=int,
            default=POLL_INTERVAL_SECONDS,
            help='poll interval seconds with --loop',
        )

    def handle(self, *args, **options):
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s %(levelname)s %(name)s: %(message)s',
        )
        while True:
            # Liveness: "worker down" and "worker idle" must be distinguishable from
            # outside (migration 0029). Never fatal — see api/worker_health.
            record_heartbeat(
                'analysis',
                {'mode': 'loop' if options['loop'] else 'once', 'limit': options['limit']},
            )
            if supervisor_gone():
                self.stderr.write(
                    '[analysis] supervisor gone; exiting (a backend restart starts a fresh worker)'
                )
                return
            processed = self._pass(options['limit'])
            if not options['loop']:
                self.stdout.write(f'Pass complete: {processed} submission(s) processed.')
                return
            if self.deferred:
                backoff = getattr(settings, 'TRANSIENT_BACKOFF_SECONDS', 60.0)
                self.stderr.write(
                    f'Transient provider failure; backing off {backoff:.0f}s '
                    '(no analysis attempt spent).'
                )
                time.sleep(backoff)
            elif processed == 0:
                time.sleep(options['interval'])

    def _pass(self, limit: int) -> int:
        self._recover_zombies()
        processed = 0
        self.deferred = False
        while processed < limit:
            submission_id = self._claim_next()
            if submission_id is None:
                break
            result = analyze_submission(submission_id)
            processed += 1
            self.stdout.write(f'  {submission_id} -> {result}')
            if result == 'DEFERRED':
                # Provider-side outage: stop the pass. Nothing about the queue changed,
                # so claiming the next row would just hit the same wall.
                self.deferred = True
                break
        return processed

    def _recover_zombies(self):
        cutoff = timezone.now() - timedelta(minutes=ANALYZING_TIMEOUT_MINUTES)
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM submissions
                WHERE status = 'ANALYZING' AND submitted_at < %s
                """,
                [cutoff],
            )
            stale = [str(r[0]) for r in cur.fetchall()]
        for sid in stale:
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        'CALL sp_mark_submission_failed(%s, %s);',
                        [sid, f'Worker timeout: stuck in ANALYZING > {ANALYZING_TIMEOUT_MINUTES} min'],
                    )
                logger.info('Recovered zombie ANALYZING submission %s', sid)
            except Exception as e:
                logger.warning('Zombie recovery failed for %s: %s', sid, e)

    def _claim_next(self):
        max_runs = getattr(settings, 'LLM_MAX_RUNS', 3)
        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE submissions
                SET status = status
                WHERE id = (
                    SELECT s.id FROM submissions s
                    WHERE (
                            -- Migration 0028: cap by the retry counter, not by the
                            -- analysis count. A failure at the LLM level writes no
                            -- llm_analyses row, so counting those left the cap inert
                            -- and the row was re-claimed forever, blocking the queue.
                            (
                                s.status IN ('SUBMITTED', 'ANALYSIS_FAILED')
                                AND s.analysis_attempts < %s
                            )
                            OR (
                                s.status = 'REJECTED'
                                AND (SELECT count(*) FROM llm_analyses la
                                     WHERE la.submission_id = s.id) < %s
                            )
                          )
                    -- Fresh work first: a row that keeps failing sorts last instead of
                    -- being the permanent head of the queue.
                    ORDER BY (s.status = 'ANALYSIS_FAILED'), s.submitted_at
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING id;
                """,
                [max_runs, max_runs],
            )
            row = cur.fetchone()
        return str(row[0]) if row else None
