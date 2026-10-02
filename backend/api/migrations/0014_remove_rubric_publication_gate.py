from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('api', '0013_student_nim')]

    operations = [
        migrations.RunSQL(
            """
            CREATE OR REPLACE PROCEDURE sp_publish_question_version(
                IN p_question_version_id UUID,
                IN p_actor_id UUID
            )
            LANGUAGE plpgsql
            AS $$
            DECLARE
                v_question_id UUID;
                v_is_already_published BOOLEAN;
                v_subject_id UUID;
            BEGIN
                SELECT qv.question_id, qv.is_published, qs.subject_id
                INTO v_question_id, v_is_already_published, v_subject_id
                FROM question_versions qv
                JOIN questions q ON qv.question_id = q.id
                JOIN question_sets qs ON q.question_set_id = qs.id
                WHERE qv.id = p_question_version_id
                FOR UPDATE OF qv;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Question version % does not exist', p_question_version_id;
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM user_subject_roles
                    WHERE user_id = p_actor_id AND subject_id = v_subject_id AND role = 'LECTURER'
                ) AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor_id AND is_superuser = TRUE) THEN
                    RAISE EXCEPTION 'Actor % is not authorized to publish versions in subject %',
                        p_actor_id, v_subject_id;
                END IF;

                IF v_is_already_published THEN
                    RAISE NOTICE 'Question version % is already published', p_question_version_id;
                    RETURN;
                END IF;

                UPDATE question_versions SET is_published = TRUE WHERE id = p_question_version_id;

                INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
                VALUES (p_actor_id, 'PUBLISH_QUESTION_VERSION', 'question_versions', p_question_version_id, '{}'::jsonb);
            END;
            $$;
            """,
            migrations.RunSQL.noop,
        ),
    ]
