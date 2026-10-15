"""Worker liveness — the heartbeat the background workers write, and anyone can read.

Why this exists: the backend and the LLM workers are separate processes. A running
backend with no worker accepts submissions (`SUBMITTED`) and enqueues reading
material (`PENDING`) that nothing will ever process, and nothing in the API, the UI
or the logs said so. There was no way to tell "worker down" from "worker busy" from
"analysis slow". This module is that signal: one upserted row per worker kind.

Writing is best-effort by contract — a heartbeat failure must never take a worker
down (the same rule the retrieval path follows: non-fatal, log and continue).

Read it from a shell:

    python manage.py shell -c "from api.worker_health import worker_status; \\
        print(worker_status())"

or directly:

    SELECT worker_name, now() - last_seen_at AS age, pid, loop_count
    FROM worker_heartbeats ORDER BY worker_name;
"""

import json
import logging
import os

from django.db import connection

logger = logging.getLogger(__name__)

# The supervisor (api/worker_supervisor.py) writes its own row under this name, so
# "is a supervisor alive?" is the same query as "is a worker alive?".
SUPERVISOR_NAME = 'supervisor'

# Set in the environment of every worker the supervisor spawns, to that supervisor's
# PID. Its only purpose is telling "I was spawned by a supervisor" apart from "a human
# ran me with --loop", which decides whether a worker may exit on its own.
SUPERVISED_BY_ENV = 'ACM_SUPERVISED_BY'

# A supervisor writes every WORKER_SUPERVISOR_INTERVAL (10s by default). Four missed
# ticks means it is gone rather than slow.
SUPERVISOR_STALE_AFTER = 45.0

_warned = False


def record_heartbeat(worker_name, detail=None):
    """Upsert `worker_name`'s liveness row. Never raises.

    `loop_count` accumulates, so a stuck-but-alive worker (heartbeat fresh, count not
    moving) is distinguishable from a healthy one.
    """
    global _warned
    try:
        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO worker_heartbeats
                    (worker_name, last_seen_at, pid, loop_count, detail_json)
                VALUES (%s, CURRENT_TIMESTAMP, %s, 1, %s::jsonb)
                ON CONFLICT (worker_name) DO UPDATE
                    SET last_seen_at = CURRENT_TIMESTAMP,
                        pid = EXCLUDED.pid,
                        loop_count = worker_heartbeats.loop_count + 1,
                        detail_json = EXCLUDED.detail_json
                """,
                [worker_name, os.getpid(), json.dumps(detail or {})],
            )
    except Exception as e:  # noqa: BLE001 — liveness must never break the work itself
        if not _warned:
            # Warn once per process: a missing table would otherwise flood the log
            # every 5 seconds (e.g. a worker started before `migrate` ran).
            _warned = True
            logger.warning(
                'heartbeat write failed for %s (non-fatal, migration 0029 applied?): %s',
                worker_name, e,
            )


def supervisor_gone():
    """True when the supervisor that spawned this worker is no longer the live one.

    A supervisor killed with `Stop-Process` never runs its `atexit` cleanup, so its
    children would survive as orphans — still claiming queue rows, and still running
    whatever code they were started with. So each supervised worker checks on every
    tick whether its supervisor is still the current one, and exits if not.

    A worker started by hand has no `ACM_SUPERVISED_BY` and never self-terminates: an
    operator running `--loop` in a terminal is not something to kill.
    """
    owner = (os.environ.get(SUPERVISED_BY_ENV) or '').strip()
    if not owner:
        return False
    rows = worker_status(SUPERVISOR_NAME)
    if not rows:
        return True
    row = rows[0]
    age = row.get('age_seconds')
    if age is None or age > SUPERVISOR_STALE_AFTER:
        return True
    # A different PID means a newer supervisor owns the workers now (e.g. the backend
    # was restarted): this process is a leftover from the previous one.
    return str(row.get('pid')) != owner


def worker_status(worker_name=None):
    """Heartbeat rows with their age in seconds. `[]` when the table is absent.

    Never raises, so a diagnostics caller (or the supervisor's duplicate check) can
    use it before migrations have run.
    """
    sql = (
        'SELECT worker_name, last_seen_at, pid, loop_count, detail_json, '
        'EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_seen_at)) AS age_seconds '
        'FROM worker_heartbeats'
    )
    params = []
    if worker_name:
        sql += ' WHERE worker_name = %s'
        params.append(worker_name)
    sql += ' ORDER BY worker_name'
    try:
        with connection.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    except Exception:  # noqa: BLE001
        return []
    return [
        {
            'worker_name': row[0],
            'last_seen_at': row[1],
            'pid': row[2],
            'loop_count': row[3],
            'detail': row[4],
            'age_seconds': float(row[5]) if row[5] is not None else None,
        }
        for row in rows
    ]
