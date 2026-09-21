"""0002 — LLM pipeline V2.1 upgrade (moved from database/V2_1_LLM_Upgrade.sql).

Two DB procedure changes required by the P4 worker (api/llm.py):

1. sp_record_llm_analysis gains a state guard: it refuses to advance a
   submission unless it is still in ANALYZING, so a duplicate/late worker can
   never clobber REJECTED/VALIDATED state back to PENDING_VALIDATION.

2. New sp_mark_submission_failed(submission_id, error_message):
   ANALYZING -> ANALYSIS_FAILED with an audit row. Previously no procedure
   existed for this transition (the worker would have needed raw UPDATEs,
   violating the project rule that lifecycle writes go through procs).

Both statements are CREATE OR REPLACE and safe to run on the deployed VPS DB.
The reverse restores the pre-V2.1 unguarded sp_record_llm_analysis and drops
sp_mark_submission_failed.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql=[r"""CREATE OR REPLACE PROCEDURE sp_record_llm_analysis(
    IN  p_submission_id UUID,
    IN  p_model_identifier VARCHAR(100),
    IN  p_prompt_version VARCHAR(50),
    IN  p_percentage_correct DECIMAL(5, 2),
    IN  p_tier_level INT,
    IN  p_concept_breakdown JSONB,
    IN  p_suggested_materials JSONB,
    IN  p_explanation TEXT,
    IN  p_confidence DECIMAL(4, 3),
    IN  p_raw_output JSONB,
    IN  p_execution_time_ms INT,
    OUT p_analysis_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_subject_id UUID;
    v_tier_id UUID;
    v_tier_level INT;
    v_tier_label VARCHAR(100);
    v_next_run INT;
BEGIN
    SELECT subject_id INTO v_subject_id
    FROM submissions WHERE id = p_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission % does not exist', p_submission_id;
    END IF;

    -- [V2.1 GUARD] The submission must still be mid-analysis. Without this a
    -- duplicate/late worker could overwrite REJECTED or VALIDATED state.
    IF NOT EXISTS (
        SELECT 1 FROM submissions
        WHERE id = p_submission_id AND status = 'ANALYZING'
    ) THEN
        RAISE EXCEPTION
            'Submission % is not in ANALYZING state; refusing to record analysis',
            p_submission_id;
    END IF;

    SELECT tier_id, tier_level, tier_label
    INTO v_tier_id, v_tier_level, v_tier_label
    FROM fn_resolve_diagnostic_tier(v_subject_id, p_tier_level);

    SELECT COALESCE(MAX(run_number), 0) + 1
    INTO v_next_run
    FROM llm_analyses WHERE submission_id = p_submission_id;

    IF v_next_run > 1 THEN
        UPDATE llm_analyses
        SET is_current = FALSE
        WHERE submission_id = p_submission_id AND is_current = TRUE;
    END IF;

    p_analysis_id := gen_random_uuid();

    INSERT INTO llm_analyses (
        id, submission_id, run_number, is_current,
        model_identifier, prompt_version,
        percentage_correct,
        tier_id, tier_level_snapshot, tier_label_snapshot,
        concept_breakdown_json, suggested_materials_json,
        explanation, confidence, raw_output_json,
        execution_time_ms, created_at
    ) VALUES (
        p_analysis_id, p_submission_id, v_next_run, TRUE,
        p_model_identifier, p_prompt_version,
        p_percentage_correct,
        v_tier_id, v_tier_level, v_tier_label,
        p_concept_breakdown, p_suggested_materials,
        p_explanation, p_confidence, p_raw_output,
        p_execution_time_ms, CURRENT_TIMESTAMP
    );

    UPDATE submissions SET status = 'PENDING_VALIDATION' WHERE id = p_submission_id;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (NULL, 'RECORD_LLM_ANALYSIS', 'llm_analyses', p_analysis_id,
            jsonb_build_object(
                'submission_id', p_submission_id, 'run_number', v_next_run,
                'model', p_model_identifier, 'prompt_version', p_prompt_version
            ));
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. MARK SUBMISSION FAILED (ANALYZING -> ANALYSIS_FAILED, audited)
-- ----------------------------------------------------------------------------""", r"""CREATE OR REPLACE PROCEDURE sp_mark_submission_failed(
    IN p_submission_id UUID,
    IN p_error_message TEXT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
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
$$;"""],
            reverse_sql=[r"""DROP PROCEDURE IF EXISTS sp_mark_submission_failed(uuid, text);""", r"""CREATE OR REPLACE PROCEDURE sp_record_llm_analysis(
    IN  p_submission_id UUID,
    IN  p_model_identifier VARCHAR(100),
    IN  p_prompt_version VARCHAR(50),
    IN  p_percentage_correct DECIMAL(5, 2),
    IN  p_tier_level INT,
    IN  p_concept_breakdown JSONB,
    IN  p_suggested_materials JSONB,
    IN  p_explanation TEXT,
    IN  p_confidence DECIMAL(4, 3),
    IN  p_raw_output JSONB,
    IN  p_execution_time_ms INT,
    OUT p_analysis_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_subject_id UUID;
    v_tier_id UUID;
    v_tier_level INT;
    v_tier_label VARCHAR(100);
    v_next_run INT;
BEGIN
    SELECT subject_id INTO v_subject_id
    FROM submissions WHERE id = p_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission % does not exist', p_submission_id;
    END IF;

    SELECT tier_id, tier_level, tier_label
    INTO v_tier_id, v_tier_level, v_tier_label
    FROM fn_resolve_diagnostic_tier(v_subject_id, p_tier_level);

    SELECT COALESCE(MAX(run_number), 0) + 1
    INTO v_next_run
    FROM llm_analyses WHERE submission_id = p_submission_id;

    -- [OPTIMIZATION] Only demote previous analysis if this isn't the first run
    IF v_next_run > 1 THEN
        UPDATE llm_analyses
        SET is_current = FALSE
        WHERE submission_id = p_submission_id AND is_current = TRUE;
    END IF;

    p_analysis_id := gen_random_uuid();

    INSERT INTO llm_analyses (
        id, submission_id, run_number, is_current,
        model_identifier, prompt_version,
        percentage_correct,
        tier_id, tier_level_snapshot, tier_label_snapshot,
        concept_breakdown_json, suggested_materials_json,
        explanation, confidence, raw_output_json,
        execution_time_ms, created_at
    ) VALUES (
        p_analysis_id, p_submission_id, v_next_run, TRUE,
        p_model_identifier, p_prompt_version,
        p_percentage_correct,
        v_tier_id, v_tier_level, v_tier_label,
        p_concept_breakdown, p_suggested_materials,
        p_explanation, p_confidence, p_raw_output,
        p_execution_time_ms, CURRENT_TIMESTAMP
    );

    UPDATE submissions SET status = 'PENDING_VALIDATION' WHERE id = p_submission_id;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (NULL, 'RECORD_LLM_ANALYSIS', 'llm_analyses', p_analysis_id,
            jsonb_build_object(
                'submission_id', p_submission_id, 'run_number', v_next_run,
                'model', p_model_identifier, 'prompt_version', p_prompt_version
            ));
END;
$$;"""],
        ),
    ]
