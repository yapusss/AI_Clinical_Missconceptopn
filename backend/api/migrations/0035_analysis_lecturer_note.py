"""Migration 0035 — the lecturer's note travels with the analysis it criticises.

`sp_validate_analysis(REJECTED)` was the only way to say "this analysis is wrong, redo
it", and it wrote a `validations` row — which is also the record that marks a submission
reviewed. So rejecting both looked like a validation and left the submission in a state
the validation endpoint refuses once the re-analysis fails (`ANALYSIS_FAILED`).

The note belongs to the analysis, not to a validation decision: `load_context` reads it
and injects "[CATATAN DOSEN PADA ANALISIS SEBELUMNYA]" into the module-B/C prompts.
Existing rows keep the old transport — `load_context` falls back to `validations.notes`.
"""

from django.db import migrations


FORWARD = """
ALTER TABLE llm_analyses ADD COLUMN IF NOT EXISTS lecturer_note TEXT;
"""

REVERSE = """
ALTER TABLE llm_analyses DROP COLUMN IF EXISTS lecturer_note;
"""


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0034_misconception_label_embedding'),
    ]

    operations = [
        migrations.RunSQL(FORWARD, REVERSE),
    ]
