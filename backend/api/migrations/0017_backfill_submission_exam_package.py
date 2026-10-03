from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('api', '0016_submission_exam_package')]

    operations = [
        migrations.RunSQL(
            """
            UPDATE submissions AS submission
            SET exam_package_id = match.exam_package_id
            FROM (
                SELECT question_version_id, MIN(exam_package_id::text)::uuid AS exam_package_id
                FROM exam_package_questions
                GROUP BY question_version_id
                HAVING COUNT(DISTINCT exam_package_id) = 1
            ) AS match
            WHERE submission.exam_package_id IS NULL
              AND submission.question_version_id = match.question_version_id;
            """,
            migrations.RunSQL.noop,
        ),
    ]
