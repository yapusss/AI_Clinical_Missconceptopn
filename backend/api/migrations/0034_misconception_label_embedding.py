"""Migration 0034 — the misconception label embedding (Step C of calibration).

Additive and behaviour-neutral for every existing reader: it only preserves the
Phase 3 label vectors before Step C re-points `misconceptions.embedding` at the
extended text.

Why: `misconceptions.embedding` was the vector of `embed_text(label)` (migration
0033). Step C scores a misconception against BOTH representations —
`max(cos(text, label_vec), cos(text, full_vec))` — so the label vector must
survive the re-embedding of `embedding` as `label + "\\n" + description`. The
copy below moves the already-stored label vectors into the new column, so a
catalogue that was embedded by Phase 3 keeps its label vectors with zero extra
embedding calls; `embed_catalog` only has to (re)build the extended vector.

REVERSE drops exactly the column the forward added. No data is destroyed that the
forward did not create (the label vectors remain in `misconceptions.embedding`).
"""

from django.db import migrations


FORWARD_SQL = """
ALTER TABLE misconceptions
    ADD COLUMN IF NOT EXISTS label_embedding vector(1536);

UPDATE misconceptions
   SET label_embedding = embedding
 WHERE concept_id IS NOT NULL
   AND embedding IS NOT NULL
   AND label_embedding IS NULL;
"""


REVERSE_SQL = """
ALTER TABLE misconceptions DROP COLUMN IF EXISTS label_embedding;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0033_catalog_embeddings"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
