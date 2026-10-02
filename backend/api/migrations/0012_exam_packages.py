from django.db import migrations


FORWARD_SQL = """
CREATE TABLE IF NOT EXISTS exam_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_exam_package_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9\\-]{1,62}[A-Z0-9]$')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_packages_code_upper ON exam_packages (UPPER(code));
CREATE INDEX IF NOT EXISTS idx_exam_packages_subject ON exam_packages (subject_id);
DROP TRIGGER IF EXISTS set_exam_packages_updated_at ON exam_packages;
CREATE TRIGGER set_exam_packages_updated_at BEFORE UPDATE ON exam_packages FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE IF NOT EXISTS exam_package_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_package_id UUID NOT NULL REFERENCES exam_packages(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
    question_version_id UUID NOT NULL REFERENCES question_versions(id) ON DELETE RESTRICT,
    order_index INT NOT NULL,
    CONSTRAINT uq_exam_package_question UNIQUE (exam_package_id, question_id),
    CONSTRAINT uq_exam_package_question_order UNIQUE (exam_package_id, order_index)
);
"""

REVERSE_SQL = """
DROP TABLE IF EXISTS exam_package_questions;
DROP TABLE IF EXISTS exam_packages;
"""


class Migration(migrations.Migration):
    dependencies = [('api', '0011_four_tier_engine')]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
