"""`manage.py sync_reference_embeddings` — Phase C2.

A **change-detecting sync**, not a one-time backfill. For every question version
it (a) reconciles the two-row `reference_answers` mirror to match
`api/views.py::_sync_reference_answers`, then (b) computes the *effective*
reference text and its sha256, and (c) embeds only the rows whose `answer_hash`
is missing/different or whose `embedding` is NULL.

    python manage.py sync_reference_embeddings [--dry-run] [--refresh]
                                               [--limit N] [--question-version <uuid>]

* Default (no flags) == `--refresh`: walk everything, embed only what changed.
* `--dry-run` reports the plan (per-question-version reconcile counts, rows to
  embed, a chars/4 token estimate) and makes **zero network calls, zero writes**.
* Idempotent: a second run with nothing edited embeds **zero** rows.

The core lives in the module-level `sync_reference_embeddings()` so the C4 drain
can import and call it without shelling out. No signals: hash-based change
detection is sufficient because the sweep recomputes the hash every pass; raw-SQL
writes are covered by the sweep itself.

Nothing here computes similarity, applies a threshold, generates material or
touches the UI — this is C2 only.
"""

import hashlib
import logging
import uuid as uuid_lib

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from api.embeddings import EmbeddingError, embed_texts, vector_literal
from api.models import QuestionVersion

logger = logging.getLogger(__name__)

# Token estimate is the same len/4 heuristic `ingest_materials` uses.
CHARS_PER_TOKEN = 4

# The canonical mirror, byte-for-byte the semantics of
# `views.py::_sync_reference_answers` (keys / types / is_primary).
# `answer_text` is sourced from `question_versions.short_answer` /
# `question_versions.model_answer`.
REQUIRED_REFERENCE_ROWS = (
    ('JAWABAN_SINGKAT', 'CANONICAL', True),
    ('ALASAN', 'REASON', False),
)


def _effective_text(answer_key, short_answer, model_answer, fallback_text):
    """The effective reference text, matching `load_context` (llm.py:248-249).

    * `JAWABAN_SINGKAT` — `short_answer` if non-empty, else `model_answer`, else
      the mirror row's own `answer_text`.
    * `ALASAN` — `model_answer` if non-empty, else the mirror row's `answer_text`.
    """
    short = (short_answer or '').strip()
    model = (model_answer or '').strip()
    fallback = (fallback_text or '').strip()
    if answer_key == 'JAWABAN_SINGKAT':
        return short or model or fallback
    return model or fallback


def _answer_hash(text: str) -> str:
    """sha256 hex digest — the 64-char lowercase key stored in `CHAR(64)`."""
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _load_existing(question_version_id):
    """Return the mirror rows for a version as a dict keyed by `answer_key`.

    Each value is `(id, answer_key, answer_type, is_primary, answer_text,
    answer_hash, has_embedding)`.
    """
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id, answer_key, answer_type, is_primary, answer_text,
                   answer_hash, (embedding IS NOT NULL)
            FROM reference_answers
            WHERE question_version_id = %s
            """,
            [question_version_id],
        )
        rows = cur.fetchall()
    return {row[1]: row for row in rows if row[1] is not None}


def _insert_reference_row(question_version_id, answer_key, answer_text,
                          answer_type, is_primary) -> str:
    with connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO reference_answers
                (question_version_id, answer_key, answer_text, answer_type, is_primary)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            [question_version_id, answer_key, answer_text, answer_type, is_primary],
        )
        return str(cur.fetchone()[0])


def _repair_reference_row(row_id, answer_type, is_primary) -> None:
    with connection.cursor() as cur:
        cur.execute(
            'UPDATE reference_answers SET answer_type = %s, is_primary = %s WHERE id = %s',
            [answer_type, is_primary, row_id],
        )


def _store_embedding(row_id, answer_hash, vector) -> None:
    with connection.cursor() as cur:
        cur.execute(
            'UPDATE reference_answers SET answer_hash = %s, embedding = %s::vector WHERE id = %s',
            [answer_hash, vector_literal(vector), row_id],
        )


def sync_reference_embeddings(*, dry_run=False, limit=None, question_version_id=None, log=None) -> dict:
    """Reconcile the `reference_answers` mirror, then embed only what changed.

    Returns a counts dict. `dry_run=True` performs zero writes and zero network
    calls; `log` is an optional callable taking one string line.
    """
    if log is None:
        def log(_message):
            pass

    counts = {
        'question_versions': 0,
        'reconcile_created': 0,
        'reconcile_already_present': 0,
        'reconcile_repaired': 0,
        'rows_to_embed': 0,
        'rows_embedded': 0,
        'rows_skipped': 0,
        'rows_skipped_empty': 0,
        'approx_tokens': 0,
    }

    version_qs = QuestionVersion.objects.all().order_by('created_at')
    if question_version_id is not None:
        version_qs = version_qs.filter(id=question_version_id)
    if limit is not None:
        version_qs = version_qs[:limit]

    # (row_id, text, answer_hash, key, version_id) for rows needing a vector.
    to_embed: list[tuple] = []
    # (row_id, answer_hash) for rows whose hash must be written even though the
    # embedding is skipped (defensive; see comment at the decision point).
    hash_only: list[tuple] = []

    for version in version_qs:
        counts['question_versions'] += 1
        existing = _load_existing(str(version.id))
        v_created = v_present = v_repaired = v_to_embed = 0

        for answer_key, answer_type, is_primary in REQUIRED_REFERENCE_ROWS:
            row = existing.get(answer_key)
            source_text = (
                version.short_answer if answer_key == 'JAWABAN_SINGKAT' else version.model_answer
            ) or ''

            row_id = None
            stored_hash = None
            has_embedding = False
            fallback_text = source_text

            if row is None:
                v_created += 1
                counts['reconcile_created'] += 1
                if not dry_run:
                    row_id = _insert_reference_row(
                        str(version.id), answer_key, source_text, answer_type, is_primary,
                    )
                    log(f'  {version.id} {answer_key}: mirror row created')
            else:
                v_present += 1
                counts['reconcile_already_present'] += 1
                row_id = str(row[0])
                fallback_text = row[4]
                stored_hash = row[5]
                if stored_hash is not None:
                    stored_hash = stored_hash.strip()
                has_embedding = bool(row[6])
                if row[2] != answer_type or row[3] != is_primary:
                    v_repaired += 1
                    counts['reconcile_repaired'] += 1
                    if not dry_run:
                        _repair_reference_row(row_id, answer_type, is_primary)
                        log(f'  {version.id} {answer_key}: mirror row repaired '
                            f'({row[2]}/{row[3]} -> {answer_type}/{is_primary})')

            text = _effective_text(
                answer_key, version.short_answer, version.model_answer, fallback_text,
            )
            if not text:
                # Nothing to embed: an imported question version with no reference
                # answer leaves this mirror row empty. Sending '' makes the provider
                # reject the WHOLE batch (`input[7]: expected string to have >=1
                # characters`), so one empty row used to block every other row in the
                # run — observed live: 104 rows left unembedded and the sweep failing
                # on every drainer tick, forever. Leaving it unembedded is the honest
                # state: `answer_similarity` reports None when there is no reference
                # vector, which is exactly right for a question with no reference.
                counts['rows_skipped_empty'] += 1
                continue
            digest = _answer_hash(text)

            needs_embed = (
                stored_hash is None
                or stored_hash != digest
                or not has_embedding
            )
            if needs_embed:
                v_to_embed += 1
                counts['rows_to_embed'] += 1
                counts['approx_tokens'] += round(len(text) / CHARS_PER_TOKEN)
                to_embed.append((row_id, text, digest, answer_key, str(version.id)))
            elif stored_hash != digest:
                # Unreachable while `needs_embed` includes `stored_hash != digest`,
                # but kept so the hash is always persisted even if that condition
                # is ever relaxed (the C2 contract: hash is written even when the
                # embedding is skipped).
                hash_only.append((row_id, digest))
            else:
                counts['rows_skipped'] += 1

        log(
            f'  {version.id}: created={v_created} already_present={v_present} '
            f'repaired={v_repaired} to_embed={v_to_embed}'
        )

    # Apply hash-only writes (normally none) before the embedding pass.
    if not dry_run and hash_only:
        with connection.cursor() as cur:
            for row_id, digest in hash_only:
                cur.execute(
                    'UPDATE reference_answers SET answer_hash = %s WHERE id = %s',
                    [digest, row_id],
                )

    if not dry_run and to_embed:
        texts = [item[1] for item in to_embed]
        try:
            vectors = embed_texts(texts)
        except EmbeddingError as e:  # noqa: BLE001 — surface a clean command error
            raise CommandError(f'Embedding failed: {e}') from e
        if len(vectors) != len(to_embed):
            raise CommandError(
                f'Embedding count mismatch: {len(vectors)} vectors for {len(to_embed)} rows'
            )
        for (row_id, _text, digest, answer_key, version_id), vector in zip(to_embed, vectors):
            _store_embedding(row_id, digest, vector)
            logger.debug('Embedded %s row for version %s', answer_key, version_id)
        counts['rows_embedded'] = len(vectors)

    return counts


class Command(BaseCommand):
    help = (
        'Reconcile the reference_answers mirror and embed only the reference rows '
        'whose effective text changed (C2 change-detecting sync).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report the plan (reconcile + rows to embed + token estimate); '
                 'makes zero network calls and zero writes',
        )
        parser.add_argument(
            '--refresh', action='store_true',
            help='The normal sweep — walk everything, embed only what changed (default)',
        )
        parser.add_argument(
            '--limit', type=int, default=None,
            help='Cap the number of question versions processed',
        )
        parser.add_argument(
            '--question-version', dest='question_version', default=None,
            help='Restrict to a single question version (uuid)',
        )

    def handle(self, *args, **options):
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s %(levelname)s %(name)s: %(message)s',
        )

        dry_run = options['dry_run']
        limit = options['limit']
        if limit is not None and limit < 1:
            raise CommandError('--limit must be >= 1')

        question_version_id = options['question_version']
        if question_version_id:
            try:
                question_version_id = uuid_lib.UUID(str(question_version_id))
            except (ValueError, TypeError, AttributeError):
                raise CommandError(
                    f'--question-version must be a uuid (got {question_version_id!r})'
                )

        if dry_run:
            self.stdout.write(self.style.WARNING(
                'DRY RUN — plan only; zero network calls, zero writes.'
            ))

        counts = sync_reference_embeddings(
            dry_run=dry_run,
            limit=limit,
            question_version_id=question_version_id,
            log=lambda message: self.stdout.write(message),
        )

        self.stdout.write(
            'Summary: '
            f'question_versions={counts["question_versions"]} '
            f'reconcile(created={counts["reconcile_created"]}, '
            f'already_present={counts["reconcile_already_present"]}, '
            f'repaired={counts["reconcile_repaired"]}) '
            f'rows_to_embed={counts["rows_to_embed"]} '
            f'rows_embedded={counts["rows_embedded"]} '
            f'rows_skipped={counts["rows_skipped"]} '
            f'rows_skipped_empty={counts["rows_skipped_empty"]} '
            f'approx_tokens={counts["approx_tokens"]}'
        )
