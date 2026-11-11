"""Migration 0036 — exam attempt drafts and proctoring telemetry.

The exam page keeps answers in localStorage today, which means the server cannot
finalize an AUTO_SUBMIT attempt when the student is offline at the deadline.  The
draft table makes the latest answers server-visible; the event table records the
browser-side integrity signals (tab switch, blur, fullscreen exit, clipboard) and
the server-side auto-finalization outcome.

The attempt columns add the idempotency key used to survive a lost submit response
and the audit marker for how the attempt was closed.
"""

from django.db import migrations


FORWARD = """
ALTER TABLE exam_package_attempts
    ADD COLUMN IF NOT EXISTS submission_request_id UUID,
    ADD COLUMN IF NOT EXISTS submitted_via VARCHAR(20),
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS exam_attempt_drafts (
    attempt_id UUID PRIMARY KEY REFERENCES exam_package_attempts(id) ON DELETE CASCADE,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_attempt_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES exam_package_attempts(id) ON DELETE CASCADE,
    client_event_id UUID NOT NULL,
    session_id UUID,
    event_type VARCHAR(40) NOT NULL,
    severity SMALLINT NOT NULL DEFAULT 1,
    occurred_at TIMESTAMPTZ,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT uq_exam_attempt_event UNIQUE (attempt_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_attempt_events_attempt
    ON exam_attempt_events (attempt_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_exam_attempt_events_type
    ON exam_attempt_events (attempt_id, event_type);
CREATE INDEX IF NOT EXISTS idx_exam_attempt_events_recorded
    ON exam_attempt_events (recorded_at DESC);
"""

REVERSE = """
DROP TABLE IF EXISTS exam_attempt_events;
DROP TABLE IF EXISTS exam_attempt_drafts;
ALTER TABLE exam_package_attempts
    DROP COLUMN IF EXISTS last_seen_at,
    DROP COLUMN IF EXISTS submitted_via,
    DROP COLUMN IF EXISTS submission_request_id;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0035_analysis_lecturer_note"),
    ]

    operations = [
        migrations.RunSQL(FORWARD, REVERSE),
    ]
