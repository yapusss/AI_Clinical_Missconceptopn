from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('api', '0006_reference_answers')]

    operations = [
        migrations.RunSQL(
            sql="""
                DO $$
                BEGIN
                    -- Domain tables are SQL-owned and are absent while Django creates a test DB.
                    IF to_regclass('public.users') IS NOT NULL THEN
                        CREATE TABLE IF NOT EXISTS user_roles (
                            id BIGSERIAL PRIMARY KEY,
                            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                            role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'LECTURER', 'STUDENT')),
                            assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT uq_user_role UNIQUE (user_id, role)
                        );
                        INSERT INTO user_roles (user_id, role, assigned_at)
                        SELECT user_id, role::text, MIN(assigned_at)
                        FROM user_subject_roles
                        WHERE role::text IN ('LECTURER', 'STUDENT')
                        GROUP BY user_id, role
                        ON CONFLICT (user_id, role) DO NOTHING;
                        INSERT INTO user_roles (user_id, role, assigned_at)
                        SELECT id, 'ADMIN', created_at FROM users WHERE is_superuser
                        ON CONFLICT (user_id, role) DO NOTHING;
                    END IF;
                END $$;
            """,
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
