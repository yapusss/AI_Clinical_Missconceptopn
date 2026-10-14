from django.conf import settings
from django.db import migrations


FORWARD_SQL = """
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS display_name VARCHAR(150) NOT NULL DEFAULT '';
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS ai_runtime_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
    active_model_id UUID NOT NULL REFERENCES llm_models(id) ON DELETE RESTRICT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_model_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    previous_model_identifier VARCHAR(100) NOT NULL DEFAULT '',
    active_model_id UUID NOT NULL REFERENCES llm_models(id) ON DELETE RESTRICT,
    changed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""

REVERSE_SQL = """
DROP TABLE IF EXISTS ai_model_changes;
DROP TABLE IF EXISTS ai_runtime_settings;
ALTER TABLE llm_models DROP COLUMN IF EXISTS is_enabled;
ALTER TABLE llm_models DROP COLUMN IF EXISTS display_name;
"""


def seed_deployment_model(apps, schema_editor):
    model_identifier = settings.LLM_MODEL[:100]
    with schema_editor.connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO llm_models (identifier, provider, display_name, is_enabled)
            VALUES (%s, 'configured', %s, TRUE)
            ON CONFLICT (identifier) DO UPDATE
            SET is_enabled = TRUE
            RETURNING id
            """,
            [model_identifier, model_identifier],
        )
        model_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO ai_runtime_settings (id, active_model_id)
            VALUES (TRUE, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            [model_id],
        )


class Migration(migrations.Migration):
    dependencies = [('api', '0023_exam_package_expiry_behavior')]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
        migrations.RunPython(seed_deployment_model, migrations.RunPython.noop),
    ]
