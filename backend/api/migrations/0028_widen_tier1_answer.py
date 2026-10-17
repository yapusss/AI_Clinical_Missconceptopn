"""Migration 0028 — widen `submissions.tier1_answer` for LaTeX answers.

The student Tier 1 (Kesimpulan) field now accepts up to 1000 characters of
LaTeX / rich text (see `FourTierSubmissionItemSerializer`). The column was
created as `VARCHAR(120)` by migration 0010 and never actually widened: 0011
ran `ADD COLUMN IF NOT EXISTS tier1_answer VARCHAR(255)`, which is a no-op on
an existing column. As a result answers longer than 120 characters failed with
"value too long for type character varying(120)".

`TEXT` matches the sibling `tier3_reason` column and removes the length ceiling.
Storage is identical (`varchar` and `text` share the same representation) and
`varchar -> text` is a binary-coercible change, so the table is not rewritten
and the ACCESS EXCLUSIVE lock is momentary.

No procedure change is needed: PostgreSQL does not enforce the declared length
of function/procedure parameters (verified — a `varchar(5)` parameter accepts a
longer argument), so `sp_submit_conceptual_answer` keeps working unchanged.

Forward: tier1_answer -> TEXT
Reverse: tier1_answer -> VARCHAR(120) (fails if longer values already exist)
"""

from django.db import migrations


FORWARD_SQL = """
ALTER TABLE submissions
    ALTER COLUMN tier1_answer TYPE TEXT;
"""

REVERSE_SQL = """
ALTER TABLE submissions
    ALTER COLUMN tier1_answer TYPE VARCHAR(120);
"""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0027_generated_reading_materials"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
