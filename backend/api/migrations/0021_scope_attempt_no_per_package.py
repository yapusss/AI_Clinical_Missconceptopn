from django.db import migrations

# Scope attempt_no PER EXAM PACKAGE.
#
# Previously sp_submit_conceptual_answer computed attempt_no as
#   MAX(attempt_no)+1 over (student_id, question_version_id)
# which is GLOBAL across packages. When the same question version is reused in
# a new exam package, the student's FIRST submission in that new package was
# numbered Ke-3 / Ke-8 / ... (continuing the old package's counter). This made
# the "Percobaan" selector misleading and made a fresh package look like it
# inherited previous packages' answers.
#
# Fix:
#   1. Widen the uniqueness to (student, question_version, exam_package, attempt)
#      so per-package attempt numbering is legal.
#   2. Renumber historical rows to be contiguous within each package.
#   3. Replace the procedure to accept p_exam_package_id and scope the counter.

DROP_CONSTRAINT = """
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS uq_student_question_attempt;
"""

RENUMBER = """
UPDATE submissions AS s
SET attempt_no = r.rn
FROM (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY student_id,
                            question_version_id,
                            COALESCE(exam_package_id, '00000000-0000-0000-0000-000000000000'::uuid)
               ORDER BY submitted_at, id
           ) AS rn
    FROM submissions
) AS r
WHERE s.id = r.id
  AND s.attempt_no IS DISTINCT FROM r.rn;
"""

ADD_CONSTRAINT = """
ALTER TABLE submissions
    ADD CONSTRAINT uq_student_question_attempt
    UNIQUE NULLS NOT DISTINCT (student_id, question_version_id, exam_package_id, attempt_no);
"""

PROC = """
CREATE OR REPLACE PROCEDURE sp_submit_conceptual_answer(
    IN  p_student_id UUID,
    IN  p_question_version_id UUID,
    IN  p_tier1_answer VARCHAR(255),
    IN  p_tier2_confidence SMALLINT,
    IN  p_tier3_reason TEXT,
    IN  p_tier4_confidence SMALLINT,
    IN  p_heuristic_flags JSONB,
    OUT p_out_submission_id UUID,
    IN  p_submission_id UUID DEFAULT NULL,
    IN  p_exam_package_id UUID DEFAULT NULL
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

    -- Attempt number is scoped PER EXAM PACKAGE: a question reused across
    -- packages starts again at Ke-1 in each package.
    SELECT COALESCE(MAX(attempt_no), 0) + 1
    INTO v_next_attempt
    FROM submissions
    WHERE student_id = p_student_id
      AND question_version_id = p_question_version_id
      AND exam_package_id IS NOT DISTINCT FROM p_exam_package_id;

    p_out_submission_id := COALESCE(p_submission_id, gen_random_uuid());
    v_combined_text := CONCAT('Jawaban: ', p_tier1_answer, E'\\n\\nAlasan: ', p_tier3_reason);

    INSERT INTO submissions (
        id, student_id, question_version_id, answer_text,
        tier1_answer, tier2_confidence, tier3_reason, tier4_confidence,
        heuristic_flags, attempt_no, status, submitted_at, exam_package_id
    ) VALUES (
        p_out_submission_id, p_student_id, p_question_version_id, v_combined_text,
        p_tier1_answer, p_tier2_confidence, p_tier3_reason, p_tier4_confidence,
        COALESCE(p_heuristic_flags, '[]'::jsonb),
        v_next_attempt, 'SUBMITTED', CURRENT_TIMESTAMP, p_exam_package_id
    );

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (p_student_id, 'SUBMIT_FOUR_TIER_ANSWER', 'submissions', p_out_submission_id,
            jsonb_build_object(
                'attempt_no', v_next_attempt,
                'heuristic_flags', p_heuristic_flags,
                'exam_package_id', p_exam_package_id
            ));
END;
$$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0020_merge_exam_package_lifecycle_and_subject_image_url'),
    ]

    operations = [
        migrations.RunSQL(DROP_CONSTRAINT, migrations.RunSQL.noop),
        migrations.RunSQL(RENUMBER, migrations.RunSQL.noop),
        migrations.RunSQL(ADD_CONSTRAINT, migrations.RunSQL.noop),
        migrations.RunSQL(PROC, migrations.RunSQL.noop),
    ]
