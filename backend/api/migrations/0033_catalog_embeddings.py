"""Migration 0033 — catalogue embeddings (plan Phase 3).

Additive and behaviour-neutral: it declares the embedding cache for the TOPIK-1
catalogue and nothing reads it yet (Phases 4-5 own the mapping and the
missing-concept artefact). No diagnosis, reader or query changes.

1. `concepts.embedding vector(1536)` / `concepts.content_hash CHAR(64)` — the
   vector of `embed_text(name + "\n" + correct_conception)` and the sha256 of that
   exact text. The hash is the change detector (same pattern as
   `reference_answers.answer_hash`, C2): `embed_catalog` re-embeds a row only when
   its stored hash differs, so a second run embeds zero rows.
2. `misconceptions.embedding vector(1536)` / `misconceptions.content_hash CHAR(64)`
   — the vector of `embed_text(label)` and the sha256 of that label.

No index: retrieval is a per-topic scan over ~97 rows, where an exact scan is
faster and cheaper than an ANN index, and the table is far below the size where
one helps.

REVERSE drops exactly the columns the forward added, in reverse order. No data is
destroyed that the forward did not create.
"""

from django.db import migrations


FORWARD_SQL = """
ALTER TABLE concepts
    ADD COLUMN IF NOT EXISTS embedding    vector(1536),
    ADD COLUMN IF NOT EXISTS content_hash CHAR(64);

ALTER TABLE misconceptions
    ADD COLUMN IF NOT EXISTS embedding    vector(1536),
    ADD COLUMN IF NOT EXISTS content_hash CHAR(64);
"""


REVERSE_SQL = """
ALTER TABLE misconceptions
    DROP COLUMN IF EXISTS embedding,
    DROP COLUMN IF EXISTS content_hash;

ALTER TABLE concepts
    DROP COLUMN IF EXISTS embedding,
    DROP COLUMN IF EXISTS content_hash;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0032_concepts_catalog"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
