"""Migration 0027 — `generated_reading_materials` (Phase C4).

PHASE C4 ONLY. Additive and behaviour-neutral: it declares the async
reading-material store and nothing reads it in an analysis. The analysis path
only inserts a cheap `PENDING` row (no LLM call); the drain command does the
generation.

1. `generated_reading_materials`:

   - key is `(question_version_id, category)` with a plain `UNIQUE` — safe for
     `INSERT ... ON CONFLICT ... DO NOTHING`, which is the get-or-create. No
     `misconception_id` (D12), so no NULL-uniqueness trap and no sentinel.
   - `CHECK (category IN ('LK','FP','FN','MSC'))` enforces **no material for
     `SC`** (D6) in the schema, not only in code.
   - `content_md` is nullable because a `PENDING` row has no content yet.
   - `sources_json` / `grounded` / `ungrounded_source_count` are the provenance
     and data-quality flags (D10) — the only detector standing in for the human
     backstop that D7 removes.
   - `input_fingerprint CHAR(64)` drives cache reuse; a re-importing pass whose
     fingerprint matches skips the row entirely.
   - `review_status` / `flag_note` / `flagged_by` / `flagged_at` are written by
     the C6 flag path; C4 only declares them.

2. `idx_grm_drain` is a partial index over the only statuses the drain ever
   selects (`PENDING`, `STALE`), so `READY` rows never bloat it.

REVERSE drops the index and then the table.
"""

from django.db import migrations


FORWARD_SQL = """
CREATE TABLE generated_reading_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_version_id UUID NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
    category VARCHAR(10) NOT NULL CHECK (category IN ('LK','FP','FN','MSC')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','READY','STALE','FAILED')),
    content_md TEXT,
    sources_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    grounded BOOLEAN NOT NULL DEFAULT FALSE,
    ungrounded_source_count INT NOT NULL DEFAULT 0,
    input_fingerprint CHAR(64),
    error TEXT,
    attempts INT NOT NULL DEFAULT 0,
    review_status VARCHAR(20) NOT NULL DEFAULT 'UNREVIEWED'
        CHECK (review_status IN ('UNREVIEWED','OK','FLAGGED')),
    flag_note TEXT,
    flagged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    flagged_at TIMESTAMPTZ,
    model_identifier VARCHAR(100),
    prompt_version VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (question_version_id, category)
);

CREATE INDEX IF NOT EXISTS idx_grm_drain
    ON generated_reading_materials (status) WHERE status IN ('PENDING','STALE');
"""


REVERSE_SQL = """
DROP INDEX IF EXISTS idx_grm_drain;
DROP TABLE IF EXISTS generated_reading_materials;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0026_answer_similarity_and_reference_embeddings"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
