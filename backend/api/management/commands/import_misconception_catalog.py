"""`manage.py import_misconception_catalog` — the TOPIK-1 catalogue (plan Phase 2).

Imports the JSON emitted by the Phase 1 extractor into `concepts` +
`misconceptions`, topic-scoped, idempotent, dry-run by default.

    python manage.py import_misconception_catalog --file catalog_topik1.json \
        --topic "Ruang antarpartikel – Gerak partikel – Sifat partikel versus sifat zat" \
        [--subject physics] [--apply] [--no-verify]

* `--file` (required) — the extractor's `catalog_topik1.json`.
* `--topic` (required) — a topic uuid **or** its exact name (the run in the task
  brief passes the name).
* `--subject` — a subject slug or uuid; defaults to the topic's own subject,
  which is what `misconceptions.subject_id` needs.
* `--apply` — writing requires this flag. Without it (or with `--dry-run`) the
  command prints the per-entry plan and the summary and writes nothing.
* `--no-verify` — import with `verified_at` NULL. The default is *verified*
  (plan D9): the bank's rows were authored by the instrument authors, so
  `verified_at = now()` and `verified_by` stays NULL because no in-app user
  reviewed them. `source` is always `LECTURER_DEFINED`.

Shape of a run:

* concepts upsert on `(topic_id, name)`; misconceptions on
  `(concept_id, label)` with `label` = the misconception, `description` = the
  correct conception plus a trailing `Sumber:` line (the table has no citations
  column), `default_tier_id` NULL, `created_by`/`verified_by` NULL.
* A concept is created once even when several bank rows share its name; the first
  occurrence supplies `concepts.correct_conception` and every row still adds its
  own misconception (whose `description` holds that row's correct conception, so
  nothing is lost).
* `question_version_misconceptions` is **not** touched — per-question links are a
  later, optional by-product of lecturer confirmations (plan D5).
* Idempotent: re-running `--apply` inserts 0 rows and updates nothing.

The comparison logic is `api.misconception_catalog.plan_catalog` (pure, no DB),
which the DB-free tests exercise directly.
"""

import json
import uuid as uuid_lib

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from api.misconception_catalog import plan_catalog


def _resolve_topic(value):
    """A topic by uuid, else by exact name. Exactly one row must match."""
    topic_id = None
    try:
        topic_id = uuid_lib.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        topic_id = None

    with connection.cursor() as cur:
        if topic_id is not None:
            cur.execute(
                'SELECT id, name, subject_id FROM topics WHERE id = %s', [str(topic_id)],
            )
        else:
            cur.execute(
                'SELECT id, name, subject_id FROM topics WHERE name = %s', [str(value)],
            )
        rows = cur.fetchall()

    if not rows:
        raise CommandError(f'No topic matches {value!r} (uuid or exact name)')
    if len(rows) > 1:
        raise CommandError(f'{len(rows)} topics match {value!r}; pass the uuid instead')
    return rows[0]


def _resolve_subject(value):
    """A subject by uuid, else by slug. Exactly one row must match."""
    if value is None:
        return None
    subject_id = None
    try:
        subject_id = uuid_lib.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        subject_id = None

    with connection.cursor() as cur:
        if subject_id is not None:
            cur.execute('SELECT id, name, slug FROM subjects WHERE id = %s', [str(subject_id)])
        else:
            cur.execute('SELECT id, name, slug FROM subjects WHERE slug = %s', [str(value)])
        rows = cur.fetchall()

    if not rows:
        raise CommandError(f'No subject matches {value!r} (uuid or slug)')
    if len(rows) > 1:
        raise CommandError(f'{len(rows)} subjects match {value!r}')
    return rows[0]


def _load_entries(path):
    with open(path, encoding='utf-8') as handle:
        entries = json.load(handle)
    if not isinstance(entries, list) or not entries:
        raise CommandError(f'{path}: expected a non-empty JSON list of catalogue entries')

    cleaned = []
    for index, entry in enumerate(entries, start=1):
        if not isinstance(entry, dict):
            raise CommandError(f'{path}: entry {index} is not an object')
        missing = [
            field for field in ('concept', 'misconception', 'correct_conception')
            if not str(entry.get(field) or '').strip()
        ]
        if missing:
            raise CommandError(f'{path}: entry {index} is missing {", ".join(missing)}')
        citations = entry.get('citations') or []
        if not isinstance(citations, list):
            raise CommandError(f'{path}: entry {index} has a non-list "citations"')
        cleaned.append({
            'group': str(entry.get('group') or ''),
            'no': str(entry.get('no') or ''),
            'concept': str(entry['concept']).strip(),
            'misconception': str(entry['misconception']).strip(),
            'correct_conception': str(entry['correct_conception']).strip(),
            'citations': [str(citation).strip() for citation in citations if str(citation).strip()],
        })
    return cleaned


def _load_existing(topic_id):
    """`({name: correct_conception}, {(name, label): description}, {name: id})`."""
    with connection.cursor() as cur:
        cur.execute(
            'SELECT id, name, correct_conception FROM concepts WHERE topic_id = %s',
            [str(topic_id)],
        )
        concept_rows = cur.fetchall()
        cur.execute(
            """
            SELECT c.name, m.label, m.description
            FROM misconceptions m
            JOIN concepts c ON c.id = m.concept_id
            WHERE c.topic_id = %s
            """,
            [str(topic_id)],
        )
        misconception_rows = cur.fetchall()

    concepts = {name: correct for _id, name, correct in concept_rows}
    concept_ids = {name: _id for _id, name, _correct in concept_rows}
    misconceptions = {(name, label): description for name, label, description in misconception_rows}
    return concepts, misconceptions, concept_ids


class Command(BaseCommand):
    help = (
        'Import the TOPIK-1 misconception catalogue (concepts + misconceptions) '
        'from the Phase 1 JSON. Dry-run by default; --apply writes.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--file', required=True, help='Catalogue JSON (catalog_topik1.json)')
        parser.add_argument(
            '--topic', required=True,
            help='Topic uuid or exact topic name the catalogue belongs to',
        )
        parser.add_argument(
            '--subject', default=None,
            help='Subject slug or uuid (default: the topic\'s own subject)',
        )
        parser.add_argument(
            '--apply', action='store_true',
            help='Write to the database. Without it the command is a dry run.',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Explicit dry run (this is already the default)',
        )
        parser.add_argument(
            '--no-verify', dest='no_verify', action='store_true',
            help='Import with verified_at NULL instead of now() (plan D9 default is verified)',
        )

    def handle(self, *args, **options):
        if options['apply'] and options['dry_run']:
            raise CommandError('--apply and --dry-run are mutually exclusive')
        apply = options['apply'] and not options['dry_run']

        topic_id, topic_name, topic_subject_id = _resolve_topic(options['topic'])
        subject = _resolve_subject(options['subject'])
        subject_id = subject[0] if subject else topic_subject_id
        if subject_id is None:
            raise CommandError(f'Topic {topic_name!r} has no subject; pass --subject')

        entries = _load_entries(options['file'])
        concepts, misconceptions, concept_ids = _load_existing(topic_id)
        plan = plan_catalog(entries, concepts, misconceptions)
        counts = plan['counts']

        subject_label = f'{subject[1]} ({subject[2]})' if subject else str(topic_subject_id)
        self.stdout.write(
            f'Topic    : {topic_name} ({topic_id})\n'
            f'Subject  : {subject_label}\n'
            f'Entries  : {len(entries)}  '
            f'verified={"no (--no-verify)" if options["no_verify"] else "yes (verified_at = now())"}\n'
            f'Mode     : {"APPLY" if apply else "DRY RUN — nothing will be written"}'
        )

        if not apply:
            for row in plan['rows']:
                concept = row['concept'].replace('\n', ' / ')
                label = row['label'].replace('\n', ' / ')
                self.stdout.write(
                    f'  [{row["no"] or "-":>3}] concept={row["concept_action"]:<6} '
                    f'misconception={row["action"]:<9} {concept} :: {label[:90]}'
                )

        if apply:
            self._apply(
                plan,
                topic_id=topic_id,
                subject_id=subject_id,
                concept_ids=concept_ids,
                verify=not options['no_verify'],
            )

        self.stdout.write(
            'Summary: '
            f'concepts_created={counts["concepts_created"]} '
            f'misconceptions_created={counts["misconceptions_created"]} '
            f'updated={counts["updated"]} '
            f'unchanged={counts["unchanged"]}'
        )

    def _apply(self, plan, *, topic_id, subject_id, concept_ids, verify):
        """Write the plan in one transaction.

        `now()` is inlined rather than bound, so the column keeps its timestamp
        type (`'now()'` as a parameter would be a literal string).
        """
        verified = 'now()' if verify else 'NULL'
        with transaction.atomic(), connection.cursor() as cur:
            for row in plan['rows']:
                name = row['concept']

                if row['concept_action'] == 'create':
                    cur.execute(
                        f"""
                        INSERT INTO concepts
                            (topic_id, name, correct_conception, source, verified_at)
                        VALUES (%s, %s, %s, 'LECTURER_DEFINED', {verified})
                        RETURNING id
                        """,
                        [str(topic_id), name, row['correct_conception']],
                    )
                    concept_ids[name] = cur.fetchone()[0]
                elif row['concept_action'] == 'update':
                    cur.execute(
                        'UPDATE concepts SET correct_conception = %s WHERE id = %s',
                        [row['correct_conception'], concept_ids[name]],
                    )

                if row['action'] == 'create':
                    cur.execute(
                        f"""
                        INSERT INTO misconceptions
                            (subject_id, topic_id, concept_id, label, description,
                             default_tier_id, source, created_by, verified_by, verified_at)
                        VALUES (%s, %s, %s, %s, %s, NULL, 'LECTURER_DEFINED',
                                NULL, NULL, {verified})
                        """,
                        [str(subject_id), str(topic_id), concept_ids[name], row['label'],
                         row['description']],
                    )
                elif row['action'] == 'update':
                    cur.execute(
                        """
                        UPDATE misconceptions SET description = %s
                        WHERE concept_id = %s AND label = %s
                        """,
                        [row['description'], concept_ids[name], row['label']],
                    )
