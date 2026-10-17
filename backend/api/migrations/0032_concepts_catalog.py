"""Migration 0032 — the TOPIK-1 misconception catalogue (plan Phases 1-2).

Additive and behaviour-neutral: it declares the catalogue store and links
`misconceptions` to it. Nothing in the analysis pipeline reads either object yet
(Phases 3-7 own the embeddings, the mapping and the surfaces), so this migration
cannot change a diagnosis or an existing reader.

1. `concepts` — one row per documented concept of a topic:

   - `topic_id` is `NOT NULL ... ON DELETE CASCADE`: the catalogue is
     **topic-scoped** (plan D5), so a question inherits its topic's concepts and
     no per-question authoring is needed; deleting the topic takes its concepts
     with it.
   - `UNIQUE (topic_id, name)` is the import's idempotency key (task 2b): a
     re-run of `import_misconception_catalog` upserts on it.
   - `correct_conception` is the concept's own statement of the right idea, used
     later as the "did the student address this?" reference (plan D4). `TEXT`
     because several bank cells run to several paragraphs.
   - `source` is the existing `misconception_source_enum`; the bank's rows are
     imported as `LECTURER_DEFINED`.
   - `created_by` / `verified_by` / `verified_at` follow D9: the bank was authored
     by the instrument authors, so rows arrive with `verified_at` set and
     `verified_by` NULL (no in-app user reviewed them).
   - `created_at` defaults to `now()`.

2. `misconceptions.concept_id` — nullable FK to `concepts`, `ON DELETE CASCADE`
   so a concept's misconceptions are its own. Nullable keeps every existing
   `misconceptions` row valid (the catalogue does not adopt pre-existing rows) and
   the bank's 1:1 concept<->misconception shape open for many-to-one later.
   `idx_misconceptions_concept` serves the lookups the import and the future
   mapping do by `concept_id`.

REVERSE drops the column, then the index, then the table — the exact mirror of the
forward path (dropping the column also retires its index in PostgreSQL, so the
`DROP INDEX IF EXISTS` is a guarded no-op there and only matters for a partial
forward). No data is destroyed by the reverse that the forward did not create.
"""

from django.db import migrations


FORWARD_SQL = """
CREATE TABLE concepts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    correct_conception TEXT NOT NULL,
    source misconception_source_enum NOT NULL,
    created_by UUID,
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (topic_id, name)
);

ALTER TABLE misconceptions ADD COLUMN concept_id UUID REFERENCES concepts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_misconceptions_concept ON misconceptions (concept_id);
"""


REVERSE_SQL = """
ALTER TABLE misconceptions DROP COLUMN IF EXISTS concept_id;
DROP INDEX IF EXISTS idx_misconceptions_concept;
DROP TABLE IF EXISTS concepts;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0031_validation_category"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
