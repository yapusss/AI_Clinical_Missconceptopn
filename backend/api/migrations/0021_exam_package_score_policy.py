from django.db import migrations


FORWARD_SQL = """
ALTER TABLE exam_packages
    ADD COLUMN IF NOT EXISTS score_policy VARCHAR(20) NOT NULL DEFAULT 'LAST_ATTEMPT';

ALTER TABLE exam_packages
    DROP CONSTRAINT IF EXISTS chk_exam_package_score_policy;
ALTER TABLE exam_packages
    ADD CONSTRAINT chk_exam_package_score_policy
    CHECK (score_policy IN ('HIGHEST', 'AVERAGE', 'LAST_ATTEMPT'));
"""

REVERSE_SQL = """
ALTER TABLE exam_packages DROP CONSTRAINT IF EXISTS chk_exam_package_score_policy;
ALTER TABLE exam_packages DROP COLUMN IF EXISTS score_policy;
"""


class Migration(migrations.Migration):
    dependencies = [('api', '0020_merge_exam_package_lifecycle_and_subject_image_url')]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
