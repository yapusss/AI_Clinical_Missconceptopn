from django.db import migrations

FORWARD_SQL = """
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
"""

REVERSE_SQL = """
DROP TABLE IF EXISTS reference_answers CASCADE;
"""

class Migration(migrations.Migration):

    dependencies = [
        ('api', '0005_seed_help_articles'),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]