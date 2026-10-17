"""Migration 0028 — bound the analysis retry loop (`submissions.analysis_attempts`).

Fixes a queue-starvation bug in the analysis worker.

`_claim_next` accepts `status IN ('SUBMITTED','ANALYSIS_FAILED')` and orders by
`submitted_at`, but the `LLM_MAX_RUNS` cap only guarded the `REJECTED` branch. A
submission whose analysis fails at the LLM level creates NO `llm_analyses` row —
`sp_mark_submission_failed` only flips the status and appends an audit row — so its
run count never grew. It therefore stayed `ANALYSIS_FAILED`, stayed claimable, and
being the oldest it was re-claimed on every pass: infinite retry that also blocked
every later submission behind it. Observed live: four `MARK_ANALYSIS_FAILED` audit
rows for the SAME submission inside 20 seconds, and a `--limit 5` pass spending its
whole budget on that one row while four newer `SUBMITTED` submissions were never
touched.

1. `submissions.analysis_attempts` — the retry counter that was missing. Incremented
   by `sp_mark_submission_failed`, so every failure path counts, including the
   worker's zombie reaper (`ANALYZING > 10 min`), which calls the same procedure.
   The claim cap then bounds total attempts at `LLM_MAX_RUNS` (3).

2. `sp_mark_submission_failed` — same signature, so `CREATE OR REPLACE` needs no
   DROP-by-signature dance; only the UPDATE body gains the increment.

3. `idx_submissions_active_queue` — its partial predicate covered only
   `('SUBMITTED','ANALYZING')`, so the retry half of the claim could never use it.
   `ANALYSIS_FAILED` is added.

`ANALYSIS_FAILED` remains the terminal state when the cap is reached: the row simply
leaves the claim set and stays visible to a lecturer as a failed submission. No new
status, so nothing that consumes `submission_status_enum` is affected.

REVERSE restores the original procedure and index predicate, then drops the column.
"""

from django.db import migrations


FORWARD_SQL = """
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS analysis_attempts INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE PROCEDURE public.sp_mark_submission_failed(
    IN p_submission_id uuid,
    IN p_error_message text DEFAULT NULL::text
)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
    UPDATE submissions
    SET status = 'ANALYSIS_FAILED',
        analysis_attempts = analysis_attempts + 1
    WHERE id = p_submission_id
      AND status = 'ANALYZING';

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Submission % is not in ANALYZING state; cannot mark failed',
            p_submission_id;
    END IF;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (NULL, 'MARK_ANALYSIS_FAILED', 'submissions', p_submission_id,
            jsonb_build_object('error', left(coalesce(p_error_message, ''), 2000)));
END;
$procedure$;

DROP INDEX IF EXISTS idx_submissions_active_queue;
CREATE INDEX idx_submissions_active_queue
    ON submissions (status, submitted_at)
    WHERE status IN ('SUBMITTED', 'ANALYZING', 'ANALYSIS_FAILED');
"""


REVERSE_SQL = """
CREATE OR REPLACE PROCEDURE public.sp_mark_submission_failed(
    IN p_submission_id uuid,
    IN p_error_message text DEFAULT NULL::text
)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
    UPDATE submissions
    SET status = 'ANALYSIS_FAILED'
    WHERE id = p_submission_id
      AND status = 'ANALYZING';

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Submission % is not in ANALYZING state; cannot mark failed',
            p_submission_id;
    END IF;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (NULL, 'MARK_ANALYSIS_FAILED', 'submissions', p_submission_id,
            jsonb_build_object('error', left(coalesce(p_error_message, ''), 2000)));
END;
$procedure$;

DROP INDEX IF EXISTS idx_submissions_active_queue;
CREATE INDEX idx_submissions_active_queue
    ON submissions (status, submitted_at)
    WHERE status = ANY (ARRAY['SUBMITTED'::submission_status_enum,
                              'ANALYZING'::submission_status_enum]);

ALTER TABLE submissions DROP COLUMN IF EXISTS analysis_attempts;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0027_generated_reading_materials"),
        # origin/main independently put a migration at 0028 (0028_widen_tier1_answer). Both
        # branched off 0027, so the merged graph had two leaf nodes and Django refused to
        # run anything: "Conflicting migrations detected; multiple leaf nodes in the
        # migration graph: (0028_widen_tier1_answer, 0031_validation_category in api)".
        # Renumbering a migration that is already applied on the deployed DB is worse than
        # re-pointing one that has never been pushed, so this edge makes the chain linear:
        #   0027 -> 0028_widen_tier1_answer -> 0028_submission_analysis_attempts -> 0029 -> ...
        # The 0028-to-0028 naming is cosmetic; Django orders by the graph, not the number.
        # (`makemigrations --merge` is banned in this repo, so this is the hand-written form.)
        ("api", "0028_widen_tier1_answer"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
