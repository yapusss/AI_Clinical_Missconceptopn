from django.db import migrations


FORWARD_SQL = """
ALTER TABLE exam_packages
    ADD COLUMN IF NOT EXISTS expiry_behavior VARCHAR(20) NOT NULL DEFAULT 'REJECT';

ALTER TABLE exam_packages
    DROP CONSTRAINT IF EXISTS chk_exam_package_expiry_behavior;
ALTER TABLE exam_packages
    ADD CONSTRAINT chk_exam_package_expiry_behavior
    CHECK (expiry_behavior IN ('REJECT', 'AUTO_SUBMIT'));
"""

REVERSE_SQL = """
ALTER TABLE exam_packages DROP CONSTRAINT IF EXISTS chk_exam_package_expiry_behavior;
ALTER TABLE exam_packages DROP COLUMN IF EXISTS expiry_behavior;
"""


class Migration(migrations.Migration):
    dependencies = [('api', '0022_scope_attempt_no_per_package')]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
