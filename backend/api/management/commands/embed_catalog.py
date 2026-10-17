"""`manage.py embed_catalog` — Phase 3.

Embeds the TOPIK-1 catalogue: `concepts` (name + correct conception) and the
catalogue `misconceptions` (label). A **change-detecting sync**, not a one-time
backfill: only rows whose `content_hash` differs from the stored one (or whose
`embedding` is NULL) are embedded, so a re-run with nothing edited embeds zero
rows.

    python manage.py embed_catalog [--apply] [--batch-size N]

* Default == dry run: reports the plan (rows to embed, a chars/4 token estimate)
  and makes **zero network calls, zero writes**.
* `--apply` performs the embedding pass and writes `embedding` + `content_hash`.
* Refuses to run when `settings.EMBEDDINGS_DIMENSIONS != 1536`: the columns are
  `vector(1536)`, so a mis-sized vector could never be stored anyway; failing
  early keeps the error legible (the same guard `api.embeddings` enforces).

The text builders and the hash live in `api.misconception_catalog` so the command
and the tests share exactly one definition of "the embedded text".
"""

import logging

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from api.embeddings import EmbeddingError, embed_texts, vector_literal
from api.misconception_catalog import (
    catalog_content_hash,
    concept_embedding_text,
    misconception_embedding_text,
)

logger = logging.getLogger(__name__)

# Token estimate is the same len/4 heuristic `ingest_materials` uses.
CHARS_PER_TOKEN = 4

EXPECTED_DIMENSIONS = 1536


def _load_concepts():
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, correct_conception, content_hash, (embedding IS NOT NULL)
            FROM concepts
            ORDER BY topic_id, name
            """
        )
        return cur.fetchall()


def _load_misconceptions():
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id, label, content_hash, (embedding IS NOT NULL)
            FROM misconceptions
            WHERE concept_id IS NOT NULL
            ORDER BY concept_id, label
            """
        )
        return cur.fetchall()


def _store_concept(row_id, digest, vector):
    with connection.cursor() as cur:
        cur.execute(
            'UPDATE concepts SET content_hash = %s, embedding = %s::vector WHERE id = %s',
            [digest, vector_literal(vector), row_id],
        )


def _store_misconception(row_id, digest, vector):
    with connection.cursor() as cur:
        cur.execute(
            'UPDATE misconceptions SET content_hash = %s, embedding = %s::vector WHERE id = %s',
            [digest, vector_literal(vector), row_id],
        )


def embed_catalog(*, apply=False, batch_size=64, log=None) -> dict:
    """Embed every catalogue row whose text changed. Returns a counts dict."""
    if log is None:
        def log(_message):
            pass

    counts = {
        'concepts': 0,
        'misconceptions': 0,
        'concepts_to_embed': 0,
        'misconceptions_to_embed': 0,
        'rows_to_embed': 0,
        'rows_embedded': 0,
        'rows_skipped': 0,
        'approx_tokens': 0,
    }

    # (row_id, text, digest, kind) for rows needing a vector.
    to_embed: list[tuple] = []

    for row_id, name, correct_conception, stored_hash, has_embedding in _load_concepts():
        counts['concepts'] += 1
        text = concept_embedding_text(name, correct_conception)
        digest = catalog_content_hash(text)
        stored = stored_hash.strip() if stored_hash else None
        if stored is None or stored != digest or not has_embedding:
            counts['concepts_to_embed'] += 1
            counts['rows_to_embed'] += 1
            counts['approx_tokens'] += round(len(text) / CHARS_PER_TOKEN)
            to_embed.append((row_id, text, digest, 'concept'))
        else:
            counts['rows_skipped'] += 1

    for row_id, label, stored_hash, has_embedding in _load_misconceptions():
        counts['misconceptions'] += 1
        text = misconception_embedding_text(label)
        digest = catalog_content_hash(text)
        stored = stored_hash.strip() if stored_hash else None
        if stored is None or stored != digest or not has_embedding:
            counts['misconceptions_to_embed'] += 1
            counts['rows_to_embed'] += 1
            counts['approx_tokens'] += round(len(text) / CHARS_PER_TOKEN)
            to_embed.append((row_id, text, digest, 'misconception'))
        else:
            counts['rows_skipped'] += 1

    log(
        f'concepts={counts["concepts"]} (to_embed={counts["concepts_to_embed"]}) '
        f'misconceptions={counts["misconceptions"]} '
        f'(to_embed={counts["misconceptions_to_embed"]}) '
        f'total_to_embed={counts["rows_to_embed"]} '
        f'approx_tokens={counts["approx_tokens"]}'
    )

    if not apply or not to_embed:
        return counts

    texts = [item[1] for item in to_embed]
    try:
        vectors = embed_texts(texts, batch_size=batch_size)
    except EmbeddingError as e:  # noqa: BLE001 — surface a clean command error
        raise CommandError(f'Embedding failed: {e}') from e
    if len(vectors) != len(to_embed):
        raise CommandError(
            f'Embedding count mismatch: {len(vectors)} vectors for {len(to_embed)} rows'
        )

    for (row_id, _text, digest, kind), vector in zip(to_embed, vectors):
        if kind == 'concept':
            _store_concept(row_id, digest, vector)
        else:
            _store_misconception(row_id, digest, vector)
    counts['rows_embedded'] = len(vectors)

    return counts


class Command(BaseCommand):
    help = (
        'Embed the catalogue concepts + misconceptions whose text changed '
        '(Phase 3 change-detecting sync). Dry run unless --apply is given.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Perform the embedding pass and write embedding + content_hash '
                 '(default: dry run, zero network calls and zero writes)',
        )
        parser.add_argument(
            '--batch-size', dest='batch_size', type=int, default=64,
            help='Provider batch size (default 64)',
        )

    def handle(self, *args, **options):
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s %(levelname)s %(name)s: %(message)s',
        )

        if settings.EMBEDDINGS_DIMENSIONS != EXPECTED_DIMENSIONS:
            raise CommandError(
                f'EMBEDDINGS_DIMENSIONS must be {EXPECTED_DIMENSIONS} to match '
                f'concepts.embedding vector({EXPECTED_DIMENSIONS}) — got '
                f'{settings.EMBEDDINGS_DIMENSIONS}.'
            )

        batch_size = options['batch_size']
        if batch_size < 1:
            raise CommandError('--batch-size must be >= 1')

        apply = options['apply']
        if not apply:
            self.stdout.write(self.style.WARNING(
                'DRY RUN — plan only; zero network calls, zero writes. '
                'Pass --apply to embed.'
            ))

        counts = embed_catalog(
            apply=apply,
            batch_size=batch_size,
            log=lambda message: self.stdout.write(message),
        )

        self.stdout.write(
            'Summary: '
            f'concepts={counts["concepts"]} '
            f'concepts_to_embed={counts["concepts_to_embed"]} '
            f'misconceptions={counts["misconceptions"]} '
            f'misconceptions_to_embed={counts["misconceptions_to_embed"]} '
            f'rows_to_embed={counts["rows_to_embed"]} '
            f'rows_embedded={counts["rows_embedded"]} '
            f'rows_skipped={counts["rows_skipped"]} '
            f'approx_tokens={counts["approx_tokens"]}'
        )
