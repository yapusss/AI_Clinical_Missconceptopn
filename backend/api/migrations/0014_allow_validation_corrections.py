from django.db import migrations

FORWARD_SQL = """
CREATE OR REPLACE PROCEDURE sp_validate_analysis(
    IN  p_analysis_id UUID,
    IN  p_lecturer_id UUID,
    IN  p_status validation_status_enum,
    IN  p_final_percentage DECIMAL(5, 2),
    IN  p_final_tier_level INT,
    IN  p_final_feedback TEXT,
    IN  p_notes TEXT,
    OUT p_validation_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_submission_id UUID;
    v_question_version_id UUID;
    v_student_answer TEXT;
    v_subject_id UUID;
    v_orig_percentage DECIMAL(5, 2);
    v_orig_tier_id UUID;
    v_orig_tier_level INT;
    v_orig_tier_label VARCHAR(100);
    v_final_tier_id UUID;
    v_final_tier_level INT;
    v_final_tier_label VARCHAR(100);
    v_effective_final_pct DECIMAL(5, 2);
    v_effective_final_tier_level INT;
    v_structured_diff JSONB;
BEGIN
    SELECT
        a.submission_id, a.percentage_correct, a.tier_id,
        a.tier_level_snapshot, a.tier_label_snapshot,
        s.question_version_id, s.answer_text, s.subject_id
    INTO
        v_submission_id, v_orig_percentage, v_orig_tier_id,
        v_orig_tier_level, v_orig_tier_label,
        v_question_version_id, v_student_answer, v_subject_id
    FROM llm_analyses a
    JOIN submissions s ON a.submission_id = s.id
    WHERE a.id = p_analysis_id
    FOR UPDATE OF a, s;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LLM Analysis % not found', p_analysis_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_subject_roles
        WHERE user_id = p_lecturer_id AND subject_id = v_subject_id AND role = 'LECTURER'
    ) AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_lecturer_id AND is_superuser = TRUE) THEN
        RAISE EXCEPTION 'User % is not authorized to validate analyses in subject %',
            p_lecturer_id, v_subject_id;
    END IF;

    IF p_status = 'REJECTED' THEN
        v_effective_final_pct := NULL;
        v_effective_final_tier_level := NULL;
        v_final_tier_id := NULL;
        v_final_tier_level := NULL;
        v_final_tier_label := NULL;
    ELSE
        v_effective_final_pct := COALESCE(p_final_percentage, v_orig_percentage);
        v_effective_final_tier_level := COALESCE(p_final_tier_level, v_orig_tier_level);

        SELECT tier_id, tier_level, tier_label
        INTO v_final_tier_id, v_final_tier_level, v_final_tier_label
        FROM fn_resolve_diagnostic_tier(v_subject_id, v_effective_final_tier_level);
    END IF;

    v_structured_diff := jsonb_build_object(
        'percentage', jsonb_build_object(
            'from', v_orig_percentage,
            'to', v_effective_final_pct,
            'modified', (v_orig_percentage IS DISTINCT FROM v_effective_final_pct)
        ),
        'tier', jsonb_build_object(
            'from_level', v_orig_tier_level,
            'to_level', v_final_tier_level,
            'modified', (v_orig_tier_id IS DISTINCT FROM v_final_tier_id)
        )
    );

    p_validation_id := gen_random_uuid();

    INSERT INTO validations (
        id, analysis_id, lecturer_id, status,
        original_percentage, original_tier_id,
        original_tier_level_snapshot, original_tier_label_snapshot,
        final_percentage, final_tier_id,
        final_tier_level_snapshot, final_tier_label_snapshot,
        final_feedback, structured_diff_json, notes, validated_at
    ) VALUES (
        p_validation_id, p_analysis_id, p_lecturer_id, p_status,
        v_orig_percentage, v_orig_tier_id,
        v_orig_tier_level, v_orig_tier_label,
        v_effective_final_pct, v_final_tier_id,
        v_final_tier_level, v_final_tier_label,
        p_final_feedback, v_structured_diff, p_notes, CURRENT_TIMESTAMP
    )
    ON CONFLICT (analysis_id) DO UPDATE SET
        lecturer_id = EXCLUDED.lecturer_id,
        status = EXCLUDED.status,
        final_percentage = EXCLUDED.final_percentage,
        final_tier_id = EXCLUDED.final_tier_id,
        final_tier_level_snapshot = EXCLUDED.final_tier_level_snapshot,
        final_tier_label_snapshot = EXCLUDED.final_tier_label_snapshot,
        final_feedback = EXCLUDED.final_feedback,
        structured_diff_json = EXCLUDED.structured_diff_json,
        notes = EXCLUDED.notes,
        validated_at = CURRENT_TIMESTAMP
    RETURNING id INTO p_validation_id;

    IF p_status = 'REJECTED' THEN
        UPDATE submissions SET status = 'REJECTED' WHERE id = v_submission_id;
    ELSE
        UPDATE submissions SET status = 'VALIDATED' WHERE id = v_submission_id;
    END IF;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (p_lecturer_id, 'VALIDATE_ANALYSIS', 'validations', p_validation_id,
            jsonb_build_object('status', p_status, 'diff', v_structured_diff));
END;
$$;
"""

REVERSE_SQL = ""

class Migration(migrations.Migration):
    dependencies = [
        ('api', '0013_student_nim'),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]