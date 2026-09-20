from django.db import migrations


FORWARD_SQL = """
ALTER TABLE questions ADD COLUMN IF NOT EXISTS external_key VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_external_key
    ON questions (question_set_id, external_key)
    WHERE external_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS reference_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_version_id UUID NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
    answer_key VARCHAR(100),
    answer_text TEXT NOT NULL,
    answer_type VARCHAR(30) NOT NULL DEFAULT 'CANONICAL',
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_answers_key
    ON reference_answers (question_version_id, answer_key)
    WHERE answer_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    file_name VARCHAR(255) NOT NULL,
    package_code VARCHAR(64) NOT NULL,
    package_title VARCHAR(255) NOT NULL,
    package_description TEXT,
    import_type VARCHAR(30) NOT NULL DEFAULT 'QUESTION_ANSWER_CSV',
    status VARCHAR(30) NOT NULL DEFAULT 'UPLOADED',
    total_rows INT NOT NULL DEFAULT 0,
    valid_rows INT NOT NULL DEFAULT 0,
    invalid_rows INT NOT NULL DEFAULT 0,
    error_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS import_rows (
    id BIGSERIAL PRIMARY KEY,
    import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    row_number INT NOT NULL,
    question_key VARCHAR(100),
    raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'VALID',
    errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT uq_import_row_number UNIQUE (import_job_id, row_number)
);
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS package_code VARCHAR(64);
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS package_title VARCHAR(255);
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS package_description TEXT;
CREATE INDEX IF NOT EXISTS idx_import_jobs_requester ON import_jobs (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_rows_job ON import_rows (import_job_id, row_number);
"""

REVERSE_SQL = """
DROP TABLE IF EXISTS import_rows;
DROP TABLE IF EXISTS import_jobs;
DROP TABLE IF EXISTS reference_answers;
DROP INDEX IF EXISTS idx_questions_external_key;
ALTER TABLE questions DROP COLUMN IF EXISTS external_key;
"""


class Migration(migrations.Migration):
    dependencies = [('api', '0001_initial')]
    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]