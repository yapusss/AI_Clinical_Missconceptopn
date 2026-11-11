"""Server-side finalization of expired AUTO_SUBMIT exam attempts.

The browser can disappear (Wi-Fi loss, phone sleep, OS kill) before it calls the
auto-submit endpoint.  The draft rows written by the exam page are therefore
finalized here, using the same stored procedure as a normal submission.  This
worker deliberately has no LLM dependency: it only needs the database, so it must
keep running even when the analysis workers are disabled.
"""

import atexit
import html
import sys
import threading
import time
import uuid
from datetime import timedelta

import psycopg
from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone
from django.utils.html import strip_tags

from .models import (
    ExamAttemptDraft,
    ExamAttemptEvent,
    ExamPackage,
    ExamPackageAttempt,
    ExamPackageQuestion,
    Submission,
)

ADVISORY_LOCK_KEY = 918273646
_state = {'thread': None, 'lock_conn': None, 'stopped': False}


def _answer_has_text(value):
    plain = html.unescape(strip_tags(value or '')).replace('\xa0', ' ')
    return bool(plain.strip())


def _answer_is_complete(answer):
    return bool(
        answer
        and _answer_has_text(answer.get('tier1_answer'))
        and answer.get('tier2_confidence') is not None
        and _answer_has_text(answer.get('tier3_reason'))
        and answer.get('tier4_confidence') is not None
    )


def _deadline(attempt):
    if not attempt.exam_package.duration_minutes:
        return None
    return attempt.started_at + timedelta(minutes=attempt.exam_package.duration_minutes)


def _submit_answer(student_id, version_id, item, package_id):
    with connection.cursor() as cursor:
        cursor.execute(
            """
            CALL sp_submit_conceptual_answer(
                %s::uuid, %s::uuid, %s::varchar, %s::smallint,
                %s::text, %s::smallint, %s::jsonb, NULL,
                p_exam_package_id => %s::uuid
            );
            """,
            [
                str(student_id),
                str(version_id),
                item['tier1_answer'],
                item['tier2_confidence'],
                item['tier3_reason'],
                item['tier4_confidence'],
                '[]',
                str(package_id),
            ],
        )
        row = cursor.fetchone()
        submission_id = str(row[0]) if row and row[0] else None
    if not submission_id:
        raise RuntimeError('Gagal menyimpan salah satu jawaban.')
    Submission.objects.filter(pk=submission_id).update(exam_package_id=package_id)
    return submission_id


def _record_event(attempt, event_type, metadata=None):
    ExamAttemptEvent.objects.create(
        id=uuid.uuid4(),
        attempt_id=attempt.id,
        client_event_id=uuid.uuid4(),
        session_id=None,
        event_type=event_type,
        severity=2 if event_type == 'NO_DRAFT_AT_EXPIRY' else 1,
        occurred_at=timezone.now(),
        metadata=metadata or {},
    )


def _candidate_ids(limit=100):
    grace_seconds = int(getattr(settings, 'EXAM_FINALIZER_GRACE_SECONDS', 5))
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT a.id
            FROM exam_package_attempts a
            JOIN exam_packages p ON p.id = a.exam_package_id
            WHERE a.submitted_at IS NULL
              AND p.expiry_behavior = 'AUTO_SUBMIT'
              AND p.duration_minutes IS NOT NULL
              AND a.started_at + (p.duration_minutes * interval '1 minute')
                  + (%s * interval '1 second') <= NOW()
            ORDER BY a.started_at
            LIMIT %s
            """,
            [grace_seconds, limit],
        )
        return [row[0] for row in cursor.fetchall()]


def finalize_expired_attempts(limit=100):
    """Finalize one batch.  Safe to call repeatedly; returns the processed count."""
    processed = 0
    for attempt_id in _candidate_ids(limit):
        with transaction.atomic():
            attempt = (
                ExamPackageAttempt.objects
                .select_for_update(skip_locked=True)
                .filter(pk=attempt_id, submitted_at__isnull=True)
                .first()
            )
            if attempt is None:
                continue
            # Lock only the attempt row: joining exam_packages under FOR UPDATE
            # would also lock the package and can deadlock with a student submit.
            package = ExamPackage.objects.get(pk=attempt.exam_package_id)
            attempt.exam_package = package
            if package.expiry_behavior != ExamPackage.ExpiryBehavior.AUTO_SUBMIT:
                continue
            deadline = _deadline(attempt)
            if not deadline or timezone.now() < deadline:
                continue

            draft = ExamAttemptDraft.objects.filter(attempt_id=attempt.id).first()
            answers = draft.answers if draft and isinstance(draft.answers, dict) else {}
            complete = []
            for item in (
                ExamPackageQuestion.objects
                .select_related('question', 'question_version')
                .filter(exam_package=attempt.exam_package)
                .order_by('order_index')
            ):
                answer = answers.get(str(item.question_id))
                if _answer_is_complete(answer):
                    complete.append((item.question_version, answer))

            now = timezone.now()
            if not complete:
                _record_event(
                    attempt,
                    'NO_DRAFT_AT_EXPIRY',
                    {
                        'has_draft': bool(draft),
                        'answer_count': len(answers),
                    },
                )
                attempt.submitted_at = now
                attempt.submitted_via = 'NO_DRAFT'
                attempt.submission_request_id = None
                attempt.save(update_fields=['submitted_at', 'submitted_via', 'submission_request_id'])
                # Keep a partial draft for the lecturer; it is the only evidence
                # that the student had started answering before the deadline.
                processed += 1
                continue

            for version, answer in complete:
                _submit_answer(attempt.student_id, version.id, answer, attempt.exam_package_id)

            attempt.submitted_at = now
            attempt.submitted_via = 'AUTO_SERVER'
            attempt.submission_request_id = uuid.uuid4()
            attempt.save(update_fields=['submitted_at', 'submitted_via', 'submission_request_id'])
            _record_event(
                attempt,
                'AUTO_SUBMITTED_SERVER',
                {
                    'submitted_count': len(complete),
                    'draft_answer_count': len(answers),
                },
            )
            if draft:
                draft.delete()
            processed += 1
    return processed


def should_start():
    if not getattr(settings, 'AUTO_FINALIZER', True):
        return False
    argv = list(sys.argv)
    if 'test' in argv or 'runserver' not in argv:
        return False
    return True


def _acquire_lock():
    db = settings.DATABASES['default']
    try:
        conn = psycopg.connect(
            host=db.get('HOST') or 'localhost',
            port=db.get('PORT') or 5432,
            dbname=db.get('NAME'),
            user=db.get('USER'),
            password=db.get('PASSWORD'),
            autocommit=True,
        )
        with conn.cursor() as cursor:
            cursor.execute('SELECT pg_try_advisory_lock(%s)', [ADVISORY_LOCK_KEY])
            if not cursor.fetchone()[0]:
                conn.close()
                return None
        return conn
    except Exception as exc:  # noqa: BLE001
        print(f'[exam-finalizer] advisory lock unavailable ({exc}); continuing', file=sys.stderr, flush=True)
        return 'no-lock'


def _run():
    interval = float(getattr(settings, 'EXAM_FINALIZER_INTERVAL', 15.0))
    while not _state['stopped']:
        try:
            processed = finalize_expired_attempts()
            if processed:
                print(f'[exam-finalizer] finalized {processed} attempt(s)', file=sys.stderr, flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f'[exam-finalizer] tick failed: {type(exc).__name__}: {exc}', file=sys.stderr, flush=True)
        time.sleep(interval)


def start_finalizer():
    """Start the DB-only finalizer next to the web process."""
    try:
        if not should_start():
            return None
        if _state['thread'] is not None:
            return _state['thread']
        lock = _acquire_lock()
        if lock is None:
            print('[exam-finalizer] another process already owns the finalizer', file=sys.stderr, flush=True)
            return None
        _state['lock_conn'] = lock
        thread = threading.Thread(target=_run, name='exam-finalizer', daemon=True)
        _state['thread'] = thread
        thread.start()
        atexit.register(_stop)
        print('[exam-finalizer] started', file=sys.stderr, flush=True)
        return thread
    except Exception as exc:  # noqa: BLE001
        print(f'[exam-finalizer] failed to start (non-fatal): {exc}', file=sys.stderr, flush=True)
        return None


def _stop():
    _state['stopped'] = True
    if _state['lock_conn'] not in (None, 'no-lock'):
        try:
            _state['lock_conn'].close()
        except Exception:  # noqa: BLE001
            pass
