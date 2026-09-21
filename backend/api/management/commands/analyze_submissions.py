"""P4 worker — Django management command.

No Celery in this project (verified: not in requirements/settings/compose).
This is a deliberately simple polling worker over `idx_submissions_active_queue`:

    python manage.py analyze_submissions            # one pass over the queue
    python manage.py analyze_submissions --loop     # keep polling (dev worker)
    python manage.py analyze_submissions --limit 5  # cap per pass

Queue selection (matches sp_mark_submission_analyzing's legal source states):
    SUBMITTED        — never analyzed
    REJECTED         — lecturer rejected the analysis; re-run with notes
    ANALYSIS_FAILED  — retry, up to LLM_MAX_RUNS analyses per submission

Zombie recovery: submissions stuck in ANALYZING (worker died mid-run) are
reclaimed after ANALYZING_TIMEOUT_MINUTES.

Claims are atomic: `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`
so multiple workers never process the same submission.
"""

import logging
import time
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import connection
from django.utils import timezone

from api.llm import MAX_ANALYSIS_RUNS, analyze_submission

logger = logging.getLogger(__name__)

ANALYZING_TIMEOUT_MINUTES = 10
POLL_INTERVAL_SECONDS = 5


class Command(BaseCommand):
    help = 'P4 analysis worker: pick up submissions and run rubric-only LLM grading.'

    def add_arguments(self, parser):
        parser.add_argument('--loop', action='store_true', help='keep polling instead of one pass')
        parser.add_argument('--limit', type=int, default=25, help='max submissions per pass')
        parser.add_argument('--interval', type=int, default=POLL_INTERVAL_SECONDS,
                            help='poll interval seconds with --loop')

    def handle(self, *args, **options):
        logging.basicConfig(level=logging.INFO,
                            format='%(asctime)s %(levelname)s %(name)s: %(message)s')
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
        """ANALYZING rows older than the timeout belong to a dead worker -> ANALYSIS_FAILED."""
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
        """Atomically take the next queueable submission id (or None).

        REJECTED is only re-run while run budget remains; beyond that it waits
        for a lecturer to EDIT-validate instead of looping forever.
        """
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
                [MAX_ANALYSIS_RUNS],
            )
            row = cur.fetchone()
        return str(row[0]) if row else None
