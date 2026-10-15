"""Migration 0030 — `sp_defer_submission`: ANALYZING -> SUBMITTED without spending an attempt.

The retry cap (`submissions.analysis_attempts`, migration 0028) exists to stop a
submission that cannot succeed from being re-claimed forever. But it counted **every**
failure, including provider failures that say nothing about the submission: a 429 rate
limit, a 5xx, a timeout. Observed live: Groq's free-tier daily token cap (200k TPD) hit
mid-run, and four of a student's five submissions were retried straight into the cap —
each 429 spending one of `LLM_MAX_RUNS` (3) — so they became permanently
`ANALYSIS_FAILED` while the quota was merely temporarily exhausted.

`sp_defer_submission` is the missing transition: it returns the row to `SUBMITTED` so it
stays claimable, and deliberately **does not touch `analysis_attempts`**. The worker
branches on `LlmTransientError` and calls this instead of `sp_mark_submission_failed`,
then backs off, so a rate limit costs time rather than a submission.

`sp_mark_submission_failed` is unchanged: a permanent failure still spends an attempt.

REVERSE drops the procedure.
"""

from django.db import migrations


FORWARD_SQL = """
CREATE OR REPLACE PROCEDURE public.sp_defer_submission(
    IN p_submission_id uuid,
    IN p_reason text DEFAULT NULL::text
)
LANGUAGE plpgsql
AS $procedure$
BEGIN
    -- Back to SUBMITTED, so the claim set still matches it. `submitted_at` is left
    -- alone: it records when the student submitted, and rewriting it would corrupt
    -- both the queue order and the student's history. The worker is what backs off.
    UPDATE submissions
    SET status = 'SUBMITTED'
    WHERE id = p_submission_id
      AND status = 'ANALYZING';

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Submission % is not in ANALYZING state; cannot defer',
            p_submission_id;
    END IF;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (NULL, 'DEFER_ANALYSIS', 'submissions', p_submission_id,
            jsonb_build_object('reason', left(coalesce(p_reason, ''), 2000)));
END;
$procedure$;
"""

REVERSE_SQL = """
DROP PROCEDURE IF EXISTS public.sp_defer_submission(uuid, text);
"""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0029_worker_heartbeats"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
