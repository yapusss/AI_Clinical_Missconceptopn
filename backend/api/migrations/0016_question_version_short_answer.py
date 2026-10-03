from django.db import migrations


FORWARD_SQL = """
ALTER TABLE question_versions
    ADD COLUMN IF NOT EXISTS short_answer TEXT;
"""

REVERSE_SQL = """
ALTER TABLE question_versions
    DROP COLUMN IF EXISTS short_answer;
"""


class Migration(migrations.Migration):
    dependencies = [('api', '0015_allow_validation_corrections')]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
