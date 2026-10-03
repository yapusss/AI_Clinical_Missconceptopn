from django.db import migrations


FORWARD_SQL = """
ALTER TABLE exam_packages ADD COLUMN IF NOT EXISTS opens_at TIMESTAMPTZ;
ALTER TABLE exam_packages ADD COLUMN IF NOT EXISTS closes_at TIMESTAMPTZ;
ALTER TABLE exam_packages ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE exam_packages ADD COLUMN IF NOT EXISTS max_attempts INTEGER;
ALTER TABLE exam_packages ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_exam_package_duration_positive') THEN
        ALTER TABLE exam_packages ADD CONSTRAINT chk_exam_package_duration_positive CHECK (duration_minutes IS NULL OR duration_minutes > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_exam_package_max_attempts_positive') THEN
        ALTER TABLE exam_packages ADD CONSTRAINT chk_exam_package_max_attempts_positive CHECK (max_attempts IS NULL OR max_attempts > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_exam_package_schedule') THEN
        ALTER TABLE exam_packages ADD CONSTRAINT chk_exam_package_schedule CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at < closes_at);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS exam_package_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_package_id UUID NOT NULL REFERENCES exam_packages(id) ON DELETE RESTRICT,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMPTZ,
    CONSTRAINT uq_exam_package_attempt_number UNIQUE (exam_package_id, student_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_exam_package_attempts_student_package ON exam_package_attempts (student_id, exam_package_id, attempt_number DESC);
"""

REVERSE_SQL = """
DROP TABLE IF EXISTS exam_package_attempts;
ALTER TABLE exam_packages DROP CONSTRAINT IF EXISTS chk_exam_package_schedule;
ALTER TABLE exam_packages DROP CONSTRAINT IF EXISTS chk_exam_package_max_attempts_positive;
ALTER TABLE exam_packages DROP CONSTRAINT IF EXISTS chk_exam_package_duration_positive;
ALTER TABLE exam_packages DROP COLUMN IF EXISTS password_hash;
ALTER TABLE exam_packages DROP COLUMN IF EXISTS max_attempts;
ALTER TABLE exam_packages DROP COLUMN IF EXISTS duration_minutes;
ALTER TABLE exam_packages DROP COLUMN IF EXISTS closes_at;
ALTER TABLE exam_packages DROP COLUMN IF EXISTS opens_at;
"""


class Migration(migrations.Migration):
    dependencies = [('api', '0018_merge_submission_package_and_short_answer')]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
