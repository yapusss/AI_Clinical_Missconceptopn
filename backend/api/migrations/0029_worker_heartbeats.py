"""Migration 0029 — `worker_heartbeats`: the liveness row for the background workers.

The backend and the LLM workers are separate processes. The API only records a
submission as `SUBMITTED`; `manage.py analyze_submissions` is the only thing that
moves it on to `ANALYZING` -> `PENDING_VALIDATION`, and `manage.py
drain_reading_materials` is the only thing that turns a `PENDING` reading material
into `READY`. Nothing coupled those processes to the backend, so a running backend
with no worker accepted work it would never process — silently. Observed live: a
submission parked at "Tersimpan" with no error anywhere, and 19 hours with no
`llm_analyses` row produced at all.

This table is the missing signal. Each worker upserts its own row every tick
(`worker_name` is the primary key), so "when did this worker last run?" becomes a
query instead of an inference. One row per worker kind — never appended to — so
writing it every 5 seconds costs nothing.

Read it with:

    SELECT worker_name, last_seen_at, now() - last_seen_at AS age, pid, loop_count
    FROM worker_heartbeats ORDER BY worker_name;

REVERSE drops the table.
"""

from django.db import migrations


FORWARD_SQL = """
CREATE TABLE IF NOT EXISTS worker_heartbeats (
    worker_name  text PRIMARY KEY,
    last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    pid          integer,
    loop_count   bigint NOT NULL DEFAULT 0,
    detail_json  jsonb NOT NULL DEFAULT '{}'::jsonb
);
"""

REVERSE_SQL = """
DROP TABLE IF EXISTS worker_heartbeats;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0028_submission_analysis_attempts"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
