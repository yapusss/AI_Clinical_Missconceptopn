"""Migration 0031 — record the 5-category diagnosis on `validations`.

The UI speaks the five categories (SC/LK/FP/FN/MSC); the database only ever stored their
four-level projection (`final_tier_level` / `final_tier_id`). Because `CATEGORY_TO_LEVEL`
maps **FP and MSC both to level 2**, a lecturer correcting MSC -> FP produced a
`final_tier_level` identical to the AI's, so:

* `is_tier_modified` (generated: compares tier ids) stayed FALSE and
  `structured_diff_json` recorded "no change" — the correction vanished from the audit;
* the review page, which reconstructs the category as
  `final_tier_level == analysis.tier_level ? analysis.four_tier_category
   : levelToCode[final_tier_level]`, fell back to the AI's category;
* `levelToCode[2]` is MSC, so an FP choice rendered as MSC;
* the metrics' confusion matrix / `tier_agreement_accuracy` are computed over levels, so
  FP-vs-MSC accuracy was structurally unmeasurable.

So `validations` gains the category itself: `original_category` (the analysis's, always
recoverable) and `final_category` (the lecturer's). `sp_validate_analysis` takes
`p_final_category text DEFAULT NULL` and writes both, keeping the level as a derived
projection for the NOT NULL legacy columns.

Two deploy notes:

* The 7-arg signature is DROPped first and re-created as a thin delegating overload, so a
  caller that has not been updated keeps working and resolution stays by argument count.
  Without the explicit DROP, `CREATE OR REPLACE` would have created a second overload
  instead of replacing it. (A `p_final_category text DEFAULT NULL` was tried first and
  rejected: PostgreSQL accepts the declaration but then refuses to resolve a call that
  omits the argument, so the default bought nothing.)
* Backfill: `original_category` is exact. `final_category` is only inferable where the
  tier did not change — a historical FP<->MSC correction is unrecoverable and stays NULL.

REVERSE restores the original 7-arg procedure verbatim (generated from the live
definition, not retyped) and drops both columns.
"""

from django.db import migrations


FORWARD_SQL = """
ALTER TABLE validations ADD COLUMN IF NOT EXISTS original_category text;
ALTER TABLE validations ADD COLUMN IF NOT EXISTS final_category text;

-- original_category is fully recoverable: it is the analysis's own category.
UPDATE validations v
   SET original_category = a.four_tier_category
  FROM llm_analyses a
 WHERE a.id = v.analysis_id
   AND v.original_category IS NULL;

-- final_category is only inferable where the tier did NOT change. FP and MSC both map
-- to level 2, so a past FP<->MSC correction is indistinguishable here and stays NULL;
-- the UI keeps its existing level->category fallback for exactly those rows.
UPDATE validations v
   SET final_category = v.original_category
 WHERE v.final_category IS NULL
   AND v.status <> 'REJECTED'
   AND v.is_tier_modified = FALSE
   AND v.original_category IS NOT NULL;

-- DROP by exact signature first. CREATE OR REPLACE with a different argument list
-- would leave the 7-arg procedure in place as a second OVERLOAD, and any caller that
-- still passes 7 arguments would keep hitting the version that writes no category —
-- silently. (Same trap the project already documented for sp_record_llm_analysis.)
DROP PROCEDURE IF EXISTS public.sp_validate_analysis(uuid, uuid, validation_status_enum, numeric, integer, text, text);

CREATE PROCEDURE public.sp_validate_analysis(IN p_analysis_id uuid, IN p_lecturer_id uuid, IN p_status validation_status_enum, IN p_final_percentage numeric, IN p_final_tier_level integer, IN p_final_feedback text, IN p_notes text, IN p_final_category text, OUT p_validation_id uuid)
LANGUAGE plpgsql
AS $procedure$

DECLARE
    v_submission_id UUID;
    v_question_version_id UUID;
    v_student_answer TEXT;
    v_subject_id UUID;
    v_orig_percentage DECIMAL(5, 2);
    v_orig_tier_id UUID;
    v_orig_tier_level INT;
    v_orig_tier_label VARCHAR(100);
    v_orig_category TEXT;
    v_final_category TEXT;
    v_final_tier_id UUID;
    v_final_tier_level INT;
    v_final_tier_label VARCHAR(100);
    v_effective_final_pct DECIMAL(5, 2);
    v_effective_final_tier_level INT;
    v_structured_diff JSONB;
BEGIN
    SELECT
        a.submission_id, a.percentage_correct, a.tier_id,
        a.tier_level_snapshot, a.tier_label_snapshot, a.four_tier_category,
        s.question_version_id, s.answer_text, s.subject_id
    INTO
        v_submission_id, v_orig_percentage, v_orig_tier_id,
        v_orig_tier_level, v_orig_tier_label, v_orig_category,
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
        v_final_category := NULL;
    ELSE
        v_effective_final_pct := COALESCE(p_final_percentage, v_orig_percentage);
        v_effective_final_tier_level := COALESCE(p_final_tier_level, v_orig_tier_level);
        -- The 5-category diagnosis, not its 4-level projection: FP and MSC both map
        -- to level 2, so the level alone cannot record which one the lecturer chose.
        v_final_category := COALESCE(p_final_category, v_orig_category);

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
        original_tier_level_snapshot, original_tier_label_snapshot, original_category,
        final_percentage, final_tier_id,
        final_tier_level_snapshot, final_tier_label_snapshot, final_category,
        final_feedback, structured_diff_json, notes, validated_at
    ) VALUES (
        p_validation_id, p_analysis_id, p_lecturer_id, p_status,
        v_orig_percentage, v_orig_tier_id,
        v_orig_tier_level, v_orig_tier_label, v_orig_category,
        v_effective_final_pct, v_final_tier_id,
        v_final_tier_level, v_final_tier_label, v_final_category,
        p_final_feedback, v_structured_diff, p_notes, CURRENT_TIMESTAMP
    )
    ON CONFLICT (analysis_id) DO UPDATE SET
        lecturer_id = EXCLUDED.lecturer_id,
        status = EXCLUDED.status,
        final_percentage = EXCLUDED.final_percentage,
        final_tier_id = EXCLUDED.final_tier_id,
        final_tier_level_snapshot = EXCLUDED.final_tier_level_snapshot,
        final_tier_label_snapshot = EXCLUDED.final_tier_label_snapshot,
        final_category = EXCLUDED.final_category,
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

$procedure$;

-- Compatibility overload for callers that have not been updated yet (and for the window
-- where new code runs against an un-migrated database in the other direction). It
-- delegates with a NULL category, which the main procedure COALESCEs to the analysis's
-- own category — i.e. "the diagnosis did not change", the only thing a 7-arg caller
-- could have meant. Remove once no 7-arg caller remains:
--   DROP PROCEDURE public.sp_validate_analysis(uuid, uuid, validation_status_enum, numeric, integer, text, text);
CREATE PROCEDURE public.sp_validate_analysis(IN p_analysis_id uuid, IN p_lecturer_id uuid, IN p_status validation_status_enum, IN p_final_percentage numeric, IN p_final_tier_level integer, IN p_final_feedback text, IN p_notes text, OUT p_validation_id uuid)
LANGUAGE plpgsql
AS $procedure$
BEGIN
    CALL public.sp_validate_analysis(
        p_analysis_id, p_lecturer_id, p_status, p_final_percentage,
        p_final_tier_level, p_final_feedback, p_notes, NULL, p_validation_id
    );
END;
$procedure$;
"""

REVERSE_SQL = """
DROP PROCEDURE IF EXISTS public.sp_validate_analysis(uuid, uuid, validation_status_enum, numeric, integer, text, text, text);
DROP PROCEDURE IF EXISTS public.sp_validate_analysis(uuid, uuid, validation_status_enum, numeric, integer, text, text);

CREATE PROCEDURE public.sp_validate_analysis(IN p_analysis_id uuid, IN p_lecturer_id uuid, IN p_status validation_status_enum, IN p_final_percentage numeric, IN p_final_tier_level integer, IN p_final_feedback text, IN p_notes text, OUT p_validation_id uuid)
LANGUAGE plpgsql
AS $procedure$

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

$procedure$;

ALTER TABLE validations DROP COLUMN IF EXISTS final_category;
ALTER TABLE validations DROP COLUMN IF EXISTS original_category;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0030_defer_submission"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
