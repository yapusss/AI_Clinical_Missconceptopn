from django.db import migrations


class Migration(migrations.Migration):
    """Linearizes the two `0024` leaves created by the 2026-10-14 reconciliation.

    `origin/main` added `0024_admin_ai_model_settings`; the R-phase branch added
    `0024_grounding_and_knowledge_ingest`. Both depend on
    `0023_exam_package_expiry_behavior`, so the `api` app had two leaf nodes and
    Django refused to build the graph ("multiple leaf nodes in the migration
    graph"). This migration has no operations — it exists only to rejoin them,
    following the same hand-written convention as
    `0018_merge_submission_package_and_short_answer` and
    `0020_merge_exam_package_lifecycle_and_subject_image_url`.

    Consequence: the C-phase's first migration is `0026`, not `0025`.
    """

    dependencies = [
        ('api', '0024_admin_ai_model_settings'),
        ('api', '0024_grounding_and_knowledge_ingest'),
    ]

    operations = []
