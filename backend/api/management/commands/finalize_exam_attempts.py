"""Finalize expired AUTO_SUBMIT exam attempts from server-side drafts.

Normally the backend starts this as a DB-only daemon thread (see
`api.exam_finalizer`), because auto-submit must keep working when the student is
offline.  This command is the manual/standalone escape hatch for deployments
where the backend is not started with `runserver`.
"""

import time

from django.core.management.base import BaseCommand

from api.exam_finalizer import finalize_expired_attempts


class Command(BaseCommand):
    help = 'Finalize expired AUTO_SUBMIT exam attempts from server-side drafts.'

    def add_arguments(self, parser):
        parser.add_argument('--loop', action='store_true', help='Keep running forever.')
        parser.add_argument('--interval', type=float, default=15.0)

    def handle(self, *args, **options):
        if not options['loop']:
            count = finalize_expired_attempts()
            self.stdout.write(f'finalized {count} attempt(s)')
            return

        while True:
            try:
                count = finalize_expired_attempts()
                if count:
                    self.stdout.write(f'finalized {count} attempt(s)')
            except Exception as exc:  # noqa: BLE001 — a loop must not die on one bad tick
                self.stderr.write(f'finalizer tick failed: {type(exc).__name__}: {exc}')
            time.sleep(options['interval'])
