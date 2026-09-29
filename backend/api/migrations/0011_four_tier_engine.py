"""Migration 0011 — Four-Tier Diagnostic Diagnostic Engine (v2.6)

1. Updates `submissions` with four-tier fields:
   - tier1_answer VARCHAR(255)
   - tier2_confidence SMALLINT CHECK (1-6)
   - tier3_reason TEXT
   - tier4_confidence SMALLINT CHECK (1-6)
   - heuristic_flags JSONB DEFAULT '[]'::jsonb

2. Updates `llm_analyses` with modular outputs and 16-rule matrix results:
   - module_a_score VARCHAR(20) ('BENAR', 'BENAR_SEBAGIAN', 'SALAH')
   - module_b_score VARCHAR(20) ('BENAR', 'SALAH')
   - module_c_code VARCHAR(100) (Catalog misconception code or 'MK-LAIN')
   - four_tier_category VARCHAR(10) ('SC', 'FP', 'FN', 'MSC', 'LK')
   - risk_level VARCHAR(20) ('TERTINGGI', 'TINGGI', 'SEDANG', 'RENDAH')

3. Replaces `sp_submit_conceptual_answer` and `sp_record_llm_analysis` with four-tier signatures.
"""

from django.db import migrations

FORWARD_SQL = """
-- 1. Ensure submissions has all four-tier columns & enlarge tier1 if needed
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS tier1_answer VARCHAR(255),
    ADD COLUMN IF NOT EXISTS tier2_confidence SMALLINT CHECK (tier2_confidence BETWEEN 1 AND 6),
    ADD COLUMN IF NOT EXISTS tier3_reason TEXT,
    ADD COLUMN IF NOT EXISTS tier4_confidence SMALLINT CHECK (tier4_confidence BETWEEN 1 AND 6),
    ADD COLUMN IF NOT EXISTS heuristic_flags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2. LLM analyses additions (these are completely new to 0011)
ALTER TABLE llm_analyses
    ADD COLUMN IF NOT EXISTS module_a_score VARCHAR(20),
    ADD COLUMN IF NOT EXISTS module_b_score VARCHAR(20),
    ADD COLUMN IF NOT EXISTS module_c_code VARCHAR(100),
    ADD COLUMN IF NOT EXISTS four_tier_category VARCHAR(10),
    ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20);

-- 3. Procedure: sp_submit_conceptual_answer upgrade
CREATE OR REPLACE PROCEDURE sp_submit_conceptual_answer(
    IN  p_student_id UUID,
    IN  p_question_version_id UUID,
    IN  p_tier1_answer VARCHAR(255),
    IN  p_tier2_confidence SMALLINT,
    IN  p_tier3_reason TEXT,
    IN  p_tier4_confidence SMALLINT,
    IN  p_heuristic_flags JSONB,
    OUT p_out_submission_id UUID,
    IN  p_submission_id UUID DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_is_published BOOLEAN;
    v_subject_id UUID;
    v_next_attempt INT;
    v_combined_text TEXT;
BEGIN
    SELECT qv.is_published, qs.subject_id
    INTO v_is_published, v_subject_id
    FROM question_versions qv
    JOIN questions q ON qv.question_id = q.id
    JOIN question_sets qs ON q.question_set_id = qs.id
    WHERE qv.id = p_question_version_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question version % does not exist', p_question_version_id;
    END IF;

    IF NOT v_is_published THEN
        RAISE EXCEPTION 'Cannot submit to an unpublished question version %', p_question_version_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_subject_roles
        WHERE user_id = p_student_id AND subject_id = v_subject_id AND role = 'STUDENT'
    ) AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_student_id AND is_superuser = TRUE) THEN
        RAISE EXCEPTION 'User % is not authorized to submit to subject %',
            p_student_id, v_subject_id;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtext(p_student_id::text),
        hashtext(p_question_version_id::text)
    );

    SELECT COALESCE(MAX(attempt_no), 0) + 1
    INTO v_next_attempt
    FROM submissions
    WHERE student_id = p_student_id AND question_version_id = p_question_version_id;

    p_out_submission_id := COALESCE(p_submission_id, gen_random_uuid());
    v_combined_text := CONCAT('Jawaban: ', p_tier1_answer, E'\\n\\nAlasan: ', p_tier3_reason);

    INSERT INTO submissions (
        id, student_id, question_version_id, answer_text,
        tier1_answer, tier2_confidence, tier3_reason, tier4_confidence,
        heuristic_flags, attempt_no, status, submitted_at
    ) VALUES (
        p_out_submission_id, p_student_id, p_question_version_id, v_combined_text,
        p_tier1_answer, p_tier2_confidence, p_tier3_reason, p_tier4_confidence,
        COALESCE(p_heuristic_flags, '[]'::jsonb),
        v_next_attempt, 'SUBMITTED', CURRENT_TIMESTAMP
    );

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (p_student_id, 'SUBMIT_FOUR_TIER_ANSWER', 'submissions', p_out_submission_id,
            jsonb_build_object('attempt_no', v_next_attempt, 'heuristic_flags', p_heuristic_flags));
END;
$$;

-- 4. Procedure: sp_record_llm_analysis upgrade
CREATE OR REPLACE PROCEDURE sp_record_llm_analysis(
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
    IN  p_module_a_score VARCHAR(20),
    IN  p_module_b_score VARCHAR(20),
    IN  p_module_c_code VARCHAR(100),
    IN  p_four_tier_category VARCHAR(10),
    IN  p_risk_level VARCHAR(20),
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

    IF NOT EXISTS (
        SELECT 1 FROM submissions
        WHERE id = p_submission_id AND status = 'ANALYZING'
    ) THEN
        RAISE EXCEPTION 'Submission % is not in ANALYZING state; refusing to record analysis',
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
        execution_time_ms,
        module_a_score, module_b_score, module_c_code,
        four_tier_category, risk_level,
        created_at
    ) VALUES (
        p_analysis_id, p_submission_id, v_next_run, TRUE,
        p_model_identifier, p_prompt_version,
        p_percentage_correct,
        v_tier_id, v_tier_level, v_tier_label,
        p_concept_breakdown, p_suggested_materials,
        p_explanation, p_confidence, p_raw_output,
        p_execution_time_ms,
        p_module_a_score, p_module_b_score, p_module_c_code,
        p_four_tier_category, p_risk_level,
        CURRENT_TIMESTAMP
    );

    UPDATE submissions SET status = 'PENDING_VALIDATION' WHERE id = p_submission_id;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (NULL, 'RECORD_FOUR_TIER_ANALYSIS', 'llm_analyses', p_analysis_id,
            jsonb_build_object(
                'submission_id', p_submission_id, 'category', p_four_tier_category,
                'risk_level', p_risk_level, 'run_number', v_next_run
            ));
END;
$$;
"""

REVERSE_SQL = """
ALTER TABLE submissions
    DROP COLUMN IF EXISTS tier1_answer,
    DROP COLUMN IF EXISTS tier2_confidence,
    DROP COLUMN IF EXISTS tier3_reason,
    DROP COLUMN IF EXISTS tier4_confidence,
    DROP COLUMN IF EXISTS heuristic_flags;

ALTER TABLE llm_analyses
    DROP COLUMN IF EXISTS module_a_score,
    DROP COLUMN IF EXISTS module_b_score,
    DROP COLUMN IF EXISTS module_c_code,
    DROP COLUMN IF EXISTS four_tier_category,
    DROP COLUMN IF EXISTS risk_level;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0010_four_tier_architecture"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]