from django.db import migrations

FORWARD_SQL = """
-- Tambah kolom 4-tier ke tabel submissions
ALTER TABLE submissions 
    ADD COLUMN IF NOT EXISTS tier1_answer VARCHAR(120),
    ADD COLUMN IF NOT EXISTS tier2_confidence INT CHECK (tier2_confidence BETWEEN 1 AND 6),
    ADD COLUMN IF NOT EXISTS tier3_reason TEXT,
    ADD COLUMN IF NOT EXISTS tier4_confidence INT CHECK (tier4_confidence BETWEEN 1 AND 6),
    ADD COLUMN IF NOT EXISTS heuristic_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS diagnostic_category VARCHAR(10),
    ADD COLUMN IF NOT EXISTS misconception_code VARCHAR(100);

-- Indeks untuk pencarian cepat kategori diagnosis (SC, LK, FP, FN, MSC)
CREATE INDEX IF NOT EXISTS idx_submissions_diagnostic 
    ON submissions (diagnostic_category, misconception_code)
    WHERE diagnostic_category IS NOT NULL;
"""

REVERSE_SQL = """
DROP INDEX IF EXISTS idx_submissions_diagnostic;
ALTER TABLE submissions 
    DROP COLUMN IF EXISTS misconception_code,
    DROP COLUMN IF EXISTS diagnostic_category,
    DROP COLUMN IF EXISTS heuristic_flags,
    DROP COLUMN IF EXISTS tier4_confidence,
    DROP COLUMN IF EXISTS tier3_reason,
    DROP COLUMN IF EXISTS tier2_confidence,
    DROP COLUMN IF EXISTS tier1_answer;
"""

class Migration(migrations.Migration):
    dependencies = [
        ('api', '0008_mandatory_question_set_topic'),
        ('api', '0009_website_section_content'),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)
    ]