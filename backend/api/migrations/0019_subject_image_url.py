from django.db import migrations


FORWARD_SQL = """
ALTER TABLE subjects
    ADD COLUMN IF NOT EXISTS image_url VARCHAR(1000);
"""

REVERSE_SQL = """
ALTER TABLE subjects
    DROP COLUMN IF EXISTS image_url;
"""


class Migration(migrations.Migration):
    dependencies = [('api', '0018_merge_submission_package_and_short_answer')]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
