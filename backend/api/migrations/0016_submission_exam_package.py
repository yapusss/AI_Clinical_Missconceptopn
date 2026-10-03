from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('api', '0015_allow_validation_corrections')]

    operations = [
        migrations.RunSQL(
            """
            ALTER TABLE submissions
                ADD COLUMN IF NOT EXISTS exam_package_id UUID
                REFERENCES exam_packages(id) ON DELETE RESTRICT;
            CREATE INDEX IF NOT EXISTS idx_submissions_student_exam_package
                ON submissions (student_id, exam_package_id, submitted_at DESC)
                WHERE exam_package_id IS NOT NULL;
            """,
            """
            DROP INDEX IF EXISTS idx_submissions_student_exam_package;
            ALTER TABLE submissions DROP COLUMN IF EXISTS exam_package_id;
            """,
        ),
    ]
