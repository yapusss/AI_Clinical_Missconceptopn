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

logger = logging.getLogger(__name__)

ANALYZING_TIMEOUT_MINUTES = 10
POLL_INTERVAL_SECONDS = 5


class Command(BaseCommand):
    help = 'P4 analysis worker: pick up submissions and run rubric-only LLM grading.'

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
            processed = self._pass(options['limit'])
            if not options['loop']:
                self.stdout.write(f'Pass complete: {processed} submission(s) processed.')
                return
            if processed == 0:
                time.sleep(options['interval'])

    def _pass(self, limit: int) -> int:
        self._recover_zombies()
        processed = 0
        while processed < limit:
            submission_id = self._claim_next()
            if submission_id is None:
                break
            result = analyze_submission(submission_id)
            processed += 1
            self.stdout.write(f'  {submission_id} -> {result}')
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
                            s.status IN ('SUBMITTED', 'ANALYSIS_FAILED')
                            OR (
                                s.status = 'REJECTED'
                                AND (SELECT count(*) FROM llm_analyses la
                                     WHERE la.submission_id = s.id) < %s
                            )
                          )
                    ORDER BY s.submitted_at
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING id;
                """,
                [max_runs],
            )
            row = cur.fetchone()
        return str(row[0]) if row else None