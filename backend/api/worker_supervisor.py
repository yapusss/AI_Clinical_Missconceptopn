"""Keep the background LLM workers alive as children of the backend process.

The problem this solves: the backend records work (`submissions.status='SUBMITTED'`,
`generated_reading_materials.status='PENDING'`) but only the two worker commands ever
*perform* it. They were launched by hand, so "backend up, worker down" was a normal
state — and a silent one: submissions sat at "Tersimpan" with no error, and reading
materials stayed `PENDING`, for as long as nobody noticed.

`start_supervisor()` is called from `ApiConfig.ready()`. In a `runserver` process it
spawns each worker as a child and restarts it if it dies, so the two halves of the
system start and stop together. Everything else (management commands, tests, the
workers themselves) is left alone.

Guards, all of which must hold before anything is spawned:

* `AUTO_WORKER` (settings, default on) — the operator's switch. `AUTO_WORKER=0` keeps
  the workers manual, which is what every earlier session did.
* the process must be a `runserver` — `migrate`, `test`, `shell` and the worker
  commands themselves must never spawn a worker (a test run spawning an LLM worker
  would spend real money).
* a real LLM key must be configured. With only the local placeholder the worker would
  burn every submission to `ANALYSIS_FAILED` in a bounded retry loop — the same
  reasoning `deploy.sh` and the compose `worker` profile already follow.
* a Postgres session-level advisory lock, so exactly one process supervises even
  though the Django autoreloader runs `ready()` in both the parent and its child.

The children inherit this process's environment (DB + LLM settings) and its stdout,
so worker logs land in the backend's log.
"""

import atexit
import logging
import os
import subprocess
import sys
import threading
import time

from django.conf import settings

from api.worker_health import SUPERVISED_BY_ENV, SUPERVISOR_NAME, record_heartbeat, worker_status

logger = logging.getLogger(__name__)

# Arbitrary but stable: identifies "the ACM worker supervisor" in pg_locks. Only one
# session can hold it, which is what makes the autoreloader double-`ready()` safe.
ADVISORY_LOCK_KEY = 918273645

# A child that dies this fast is not doing work — count it as a failure and back off
# instead of respawning in a tight loop.
FAST_EXIT_SECONDS = 10.0

_state = {
    'thread': None,
    'children': {},       # name -> subprocess.Popen
    'started_at': {},     # name -> monotonic-ish timestamp
    'failures': {},       # name -> consecutive fast exits
    'retry_after': {},    # name -> timestamp before which we do not respawn
    'lock_conn': None,    # keep the advisory-lock connection referenced
}


def worker_commands():
    """The background workers to keep alive, as `(name, argv after manage.py)`.

    All three are long-running `--loop` drains; `analyze_submissions` moves submissions
    through the analysis pipeline, `drain_reading_materials` turns PENDING/STALE
    material into READY (and rides the C2 reference-embedding sweep on every tick),
    and `ingest_materials --pending` is the ONLY thing that turns an uploaded reference
    document from PENDING into READY. Without it an upload sits at PENDING forever:
    nothing else in the stack drains `knowledge_documents`.
    """
    return [
        ('analysis', ['analyze_submissions', '--loop']),
        ('materials', ['drain_reading_materials', '--loop']),
        ('ingest', ['ingest_materials', '--pending', '--loop']),
    ]


def _llm_key_is_real():
    key = (getattr(settings, 'LLM_API_KEY', '') or '').strip()
    return bool(key) and key != 'local-llama-cpp'


def _embeddings_key_is_real():
    key = (getattr(settings, 'EMBEDDINGS_API_KEY', '') or '').strip()
    return bool(key)


def worker_skip_reason(name):
    """`reason` when `name` must NOT be spawned right now, else `None`.

    One worker needs a key the others do not: `ingest_materials` embeds chunks, and it
    marks a document FAILED on ANY exception — while `_select_pending()` only ever picks
    `PENDING` rows, so nothing retries a FAILED one. A drain running without an
    embeddings key would therefore burn every upload to FAILED, permanently. Leaving
    them PENDING (still retryable by the next tick once the key exists) is the better
    failure. The reason lands in the supervisor heartbeat, so "why is nothing being
    ingested" is answerable from `worker_heartbeats`.
    """
    if name == 'ingest' and not _embeddings_key_is_real():
        return 'EMBEDDINGS_API_KEY is not set (uploads stay PENDING until it is)'
    return None


def should_supervise(argv=None):
    """`(bool, reason)` — should THIS process own the workers?

    Pure function of argv + settings, so it is cheap to test.
    """
    if not getattr(settings, 'AUTO_WORKER', True):
        return False, 'AUTO_WORKER is off'
    argv = list(sys.argv if argv is None else argv)
    # Checked before the runserver test: `manage.py test` has no `runserver` in argv
    # either, so this ordering is what makes the reason string name the real hazard.
    if 'test' in argv:
        return False, 'test run'
    if 'runserver' not in argv:
        return False, 'not a runserver process'
    if not _llm_key_is_real():
        return False, 'no real LLM key (LLM_API_KEY unset or the local placeholder)'
    return True, 'ok'


def _acquire_advisory_lock():
    """Take the supervisor lock. Returns the connection, `None` if held elsewhere.

    Returns the string `'no-lock'` when Postgres cannot be reached at all: a backend
    that cannot talk to the DB is already broken elsewhere, and refusing to supervise
    would be a worse failure mode than a possible duplicate worker (claims use
    `FOR UPDATE SKIP LOCKED`, so duplicates share the queue rather than fight over it).
    """
    try:
        import psycopg

        db = settings.DATABASES['default']
        conn = psycopg.connect(
            host=db.get('HOST') or 'localhost',
            port=db.get('PORT') or 5432,
            dbname=db.get('NAME'),
            user=db.get('USER'),
            password=db.get('PASSWORD'),
            autocommit=True,
        )
        with conn.cursor() as cur:
            cur.execute('SELECT pg_try_advisory_lock(%s)', [ADVISORY_LOCK_KEY])
            acquired = bool(cur.fetchone()[0])
        if not acquired:
            conn.close()
            return None
        return conn
    except Exception as e:  # noqa: BLE001
        logger.warning('[supervisor] advisory lock unavailable (%s); continuing', e)
        return 'no-lock'


def _announce(message):
    """Say what the supervisor decided, in the backend's log.

    `logger.info` is invisible here: settings define no `LOGGING`, so the root logger
    has no handler and Django's console handler only covers the `django` namespace
    (Python's last-resort handler prints WARNING and above). Whether the background
    workers were started is exactly what an operator needs to see, so this writes to
    stderr directly, the way the worker commands write to stdout.
    """
    print(f'[supervisor] {message}', file=sys.stderr, flush=True)


def start_supervisor():
    """Spawn and babysit the workers. Returns the thread, or `None` when not ours."""
    try:
        ok, reason = should_supervise()
        if not ok:
            _announce(f'not started ({reason})')
            return None
        if _state['thread'] is not None:
            return _state['thread']

        lock = _acquire_advisory_lock()
        if lock is None:
            _announce('another process already supervises the workers')
            return None
        _state['lock_conn'] = lock

        # Write our own row before spawning, so a concurrent `ready()` sees a live
        # supervisor even if it wins the advisory lock race by a hair.
        record_heartbeat(SUPERVISOR_NAME, {'state': 'starting', 'children': {}})

        thread = threading.Thread(target=_run, name='worker-supervisor', daemon=True)
        _state['thread'] = thread
        thread.start()
        atexit.register(_terminate_all)
        _announce(f'supervising {", ".join(name for name, _ in worker_commands())}')
        return thread
    except Exception as e:  # noqa: BLE001 — supervision must never break the web process
        _announce(f'failed to start (non-fatal): {e}')
        return None


def _run():
    interval = float(getattr(settings, 'WORKER_SUPERVISOR_INTERVAL', 10.0))
    while True:
        error = None
        skipped = {}
        for name, argv in worker_commands():
            reason = worker_skip_reason(name)
            if reason:
                skipped[name] = reason
                continue
            try:
                _ensure_alive(name, argv)
            except Exception as e:  # noqa: BLE001
                # The supervisor is the one process that must never die quietly: if it
                # did, the state it exists to prevent ("backend up, worker gone") would
                # come back, with no trace. A bad tick is reported and the next one runs.
                error = f'{name}: {type(e).__name__}: {e}'
                logger.warning('[supervisor] tick failed for %s: %s', name, e)
        try:
            record_heartbeat(
                SUPERVISOR_NAME,
                {
                    'state': 'running',
                    'last_error': error,
                    'skipped': skipped,
                    'children': {
                        name: (proc.pid if proc.poll() is None else None)
                        for name, proc in _state['children'].items()
                    },
                },
            )
        except Exception:  # noqa: BLE001 — record_heartbeat is already non-fatal
            pass
        time.sleep(interval)


def _ensure_alive(name, argv):
    now = time.time()
    if now < _state['retry_after'].get(name, 0.0):
        return

    proc = _state['children'].get(name)
    if proc is not None and proc.poll() is None:
        return

    if proc is not None:
        runtime = now - _state['started_at'].get(name, now)
        if runtime < FAST_EXIT_SECONDS:
            failures = _state['failures'].get(name, 0) + 1
            _state['failures'][name] = failures
            # Exponential backoff, capped: a worker that cannot start must not turn
            # into a respawn storm (it would also spam the LLM provider on each try).
            _state['retry_after'][name] = now + min(5.0 * (2 ** failures), 60.0)
            logger.warning(
                '[supervisor] %s exited after %.1fs (code %s, consecutive fast exits %d); '
                'retrying in %.0fs',
                name, runtime, proc.returncode, failures, _state['retry_after'][name] - now,
            )
        else:
            _state['failures'][name] = 0
            logger.warning(
                '[supervisor] %s exited (code %s) after %.0fs; restarting',
                name, proc.returncode, runtime,
            )

    _state['children'][name] = _spawn(name, argv)
    _state['started_at'][name] = time.time()


def _spawn(name, argv):
    cmd = [sys.executable, 'manage.py', *argv]
    logger.info('[supervisor] starting %s: %s', name, ' '.join(cmd))
    # ACM_SUPERVISED_BY is how the child knows it may exit once this supervisor is
    # gone (a hard-killed supervisor cannot run its own cleanup). stdout/stderr are
    # inherited, so the worker's log lines appear in the backend's log.
    env = dict(os.environ, **{SUPERVISED_BY_ENV: str(os.getpid())})
    return subprocess.Popen(cmd, cwd=str(settings.BASE_DIR), env=env)


def _terminate_all():
    for name, proc in list(_state['children'].items()):
        if proc.poll() is None:
            logger.info('[supervisor] stopping %s (pid %s)', name, proc.pid)
            proc.terminate()


def supervisor_status():
    """Diagnostics helper: what this process supervises and what the DB says."""
    return {
        'own_thread': _state['thread'].is_alive() if _state['thread'] else False,
        'children': {
            name: {'pid': proc.pid, 'alive': proc.poll() is None, 'returncode': proc.returncode}
            for name, proc in _state['children'].items()
        },
        'failures': dict(_state['failures']),
        'heartbeats': worker_status(),
    }
