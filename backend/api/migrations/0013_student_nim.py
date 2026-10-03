from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('api', '0012_exam_packages')]

    operations = [
        migrations.RunSQL(
            """
            DO $$
            BEGIN
                IF to_regclass('public.users') IS NOT NULL THEN
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS nim VARCHAR(32);
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nim_upper ON users (UPPER(nim)) WHERE nim IS NOT NULL;
                END IF;
            END $$;
            """,
            """
            DO $$
            BEGIN
                IF to_regclass('public.users') IS NOT NULL THEN
                    DROP INDEX IF EXISTS idx_users_nim_upper;
                    ALTER TABLE users DROP COLUMN IF EXISTS nim;
                END IF;
            END $$;
            """,
        ),
    ]
