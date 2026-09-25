from django.db import migrations


FORWARD_SQL = """
DO $$
BEGIN
    IF to_regclass('public.question_sets') IS NOT NULL THEN
        -- 1. Hapus riwayat evaluasi & submisi yang merujuk ke question versions dari question sets tanpa topic
        DELETE FROM validations
        WHERE analysis_id IN (
            SELECT la.id FROM llm_analyses la
            JOIN submissions s ON la.submission_id = s.id
            JOIN question_versions qv ON s.question_version_id = qv.id
            JOIN questions q ON qv.question_id = q.id
            JOIN question_sets qs ON q.question_set_id = qs.id
            WHERE qs.topic_id IS NULL
        );

        DELETE FROM llm_analyses
        WHERE submission_id IN (
            SELECT s.id FROM submissions s
            JOIN question_versions qv ON s.question_version_id = qv.id
            JOIN questions q ON qv.question_id = q.id
            JOIN question_sets qs ON q.question_set_id = qs.id
            WHERE qs.topic_id IS NULL
        );

        DELETE FROM submissions
        WHERE question_version_id IN (
            SELECT qv.id FROM question_versions qv
            JOIN questions q ON qv.question_id = q.id
            JOIN question_sets qs ON q.question_set_id = qs.id
            WHERE qs.topic_id IS NULL
        );

        -- 2. Hapus question_sets tanpa topic (questions, versions, indicators, reference_answers cascade otomatis)
        DELETE FROM question_sets WHERE topic_id IS NULL;

        -- 3. Set NOT NULL pada kolom topic_id
        ALTER TABLE question_sets ALTER COLUMN topic_id SET NOT NULL;
    END IF;
END $$;
"""

REVERSE_SQL = """
DO $$
BEGIN
    IF to_regclass('public.question_sets') IS NOT NULL THEN
        ALTER TABLE question_sets ALTER COLUMN topic_id DROP NOT NULL;
    END IF;
END $$;
"""


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0007_user_roles'),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]