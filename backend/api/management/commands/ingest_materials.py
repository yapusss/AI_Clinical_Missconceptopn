"""`manage.py ingest_materials` — reference-material ingestion (Phase R2).

    python manage.py ingest_materials <path> --subject <uuid|slug> [--topic <uuid|slug>]
           [--title "..."] [--replace] [--dry-run] [--limit-pages A-B] [--batch-size 64]

Stages (brief §7): extract → chunk → embed → store.

* `knowledge_documents` / `knowledge_chunks` are ingestion state, not the
  four-tier lifecycle, so this command writes them directly (raw SQL); no
  stored proc is invented.
* `--dry-run` performs extraction + chunking only and never constructs the
  embeddings client (zero network calls).
* `--replace` matches an existing document on `(subject_id, title)` and
  deletes it first; `knowledge_chunks` rows cascade away with it.
"""

import json
import logging
import os
import re
import time
from dataclasses import dataclass

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from api.embeddings import EmbeddingError, embed_texts, vector_literal

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Chunking constants
# ---------------------------------------------------------------------------
# Token count is APPROXIMATED as len(text) / 4 (the usual ~4 chars-per-token
# English heuristic). This is deliberate: no tokeniser dependency, and the
# reference PDF's ~917k chars ≈ 229k tokens matches the brief's ~230k estimate.
CHARS_PER_TOKEN = 4
TARGET_TOKENS = 800
OVERLAP_RATIO = 0.15
TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN            # 3200
OVERLAP_CHARS = int(TARGET_CHARS * OVERLAP_RATIO)         # 480
MIN_CHUNK_CHARS = int(TARGET_CHARS * 0.5)                 # never emit a stub
COST_PER_MILLION_TOKENS_USD = 0.02                        # brief §7.6

PAGE_NUMBER_RE = re.compile(r'^\s*\d{1,4}\s*$')
SECTION_NUMBER_RE = re.compile(r'^\s*\d{1,2}\s*-\s*\d{1,2}\s*$')
MULTISPACE_RE = re.compile(r' {3,}')
BLANK_RUN_RE = re.compile(r'\n{3,}')
PAGE_RANGE_RE = re.compile(r'^\s*(\d+)\s*-\s*(\d+)\s*$')


@dataclass
class Chunk:
    chunk_index: int
    content: str
    token_count: int
    page_start: int
    page_end: int
    char_start: int
    char_end: int

    @property
    def metadata(self) -> dict:
        return {
            'page_start': self.page_start,
            'page_end': self.page_end,
            'char_start': self.char_start,
            'char_end': self.char_end,
        }


# ---------------------------------------------------------------------------
# 1. Extract
# ---------------------------------------------------------------------------

def _read_pages(path: str) -> tuple[list[tuple[int, str]], str]:
    """Return ([(1-based page_no, text)], mime_type)."""
    ext = os.path.splitext(path)[1].lower()
    if ext == '.pdf':
        import pymupdf  # imported lazily so .txt/.md need no PDF stack

        doc = pymupdf.open(path)
        try:
            pages = [(i + 1, doc[i].get_text() or '') for i in range(doc.page_count)]
        finally:
            doc.close()
        return pages, 'application/pdf'
    if ext in ('.md', '.markdown'):
        with open(path, encoding='utf-8') as fh:
            return [(1, fh.read())], 'text/markdown'
    if ext == '.txt':
        with open(path, encoding='utf-8') as fh:
            return [(1, fh.read())], 'text/plain'
    raise CommandError(f'Unsupported file type {ext!r}; expected .pdf, .md or .txt')


def _apply_page_limit(pages, limit_pages):
    if not limit_pages:
        return pages
    match = PAGE_RANGE_RE.match(limit_pages)
    if not match:
        raise CommandError(f'--limit-pages must be "A-B" (got {limit_pages!r})')
    first, last = int(match.group(1)), int(match.group(2))
    if first < 1 or last < first:
        raise CommandError(f'--limit-pages range is invalid: {limit_pages!r}')
    return [(no, text) for no, text in pages if first <= no <= last]


def _is_head_like(line: str) -> bool:
    """A running head is a short all-caps line (chapter/section banner)."""
    letters = [c for c in line if c.isalpha()]
    if not letters:
        return False
    return len(line) <= 100 and all(c.isupper() for c in letters)


def _collect_running_heads(pages) -> set[str]:
    """Lines repeated on many pages and head-like → recurring running head."""
    counts: dict[str, int] = {}
    for _, text in pages:
        for line in {ln.strip() for ln in text.splitlines()}:
            if line:
                counts[line] = counts.get(line, 0) + 1
    threshold = max(3, int(len(pages) * 0.3))
    return {
        line for line, count in counts.items()
        if count >= threshold and _is_head_like(line)
    }


def _normalise(text: str, running_heads: set[str]) -> str:
    """Light normalisation: collapse 3+ spaces, drop page-number-only and
    section-number-only lines, strip the recurring running head."""
    kept = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            kept.append('')
            continue
        if PAGE_NUMBER_RE.match(stripped) or SECTION_NUMBER_RE.match(stripped):
            continue
        if stripped in running_heads:
            continue
        kept.append(MULTISPACE_RE.sub(' ', stripped))
    return BLANK_RUN_RE.sub('\n\n', '\n'.join(kept)).strip()


def _build_document(pages, running_heads) -> tuple[str, list[tuple[int, int, int]]]:
    """Join normalised pages; return (full_text, [(page_no, start, end)])."""
    parts: list[str] = []
    offsets: list[tuple[int, int, int]] = []
    cursor = 0
    for page_no, raw in pages:
        if parts:
            parts.append('\n\n')
            cursor += 2
        norm = _normalise(raw, running_heads)
        start = cursor
        parts.append(norm)
        cursor += len(norm)
        offsets.append((page_no, start, cursor))
    return ''.join(parts), offsets


# ---------------------------------------------------------------------------
# 2. Chunk
# ---------------------------------------------------------------------------

def _split_points(text: str) -> list[int]:
    """Candidate boundaries: after blank lines, then after sentence enders."""
    points = {m.end() for m in re.finditer(r'\n\s*\n', text)}
    points.update(m.end() for m in re.finditer(r'(?<=[.!?])\s+', text))
    return sorted(points)


def _chunk_text(text: str, offsets) -> list[Chunk]:
    """Target TARGET_CHARS with OVERLAP_CHARS overlap; split preference is
    blank line → sentence boundary → hard split."""
    import bisect

    if not text.strip():
        return []

    n = len(text)
    points = _split_points(text)
    chunks: list[Chunk] = []
    start = 0
    index = 0

    while start < n:
        end = min(start + TARGET_CHARS, n)
        if end < n:
            pos = bisect.bisect_right(points, end) - 1
            if pos >= 0 and points[pos] > start + MIN_CHUNK_CHARS:
                end = points[pos]

        raw = text[start:end]
        left = len(raw) - len(raw.lstrip())
        right = len(raw.rstrip())
        content = raw.strip()
        if content:
            cs = start + left
            ce = start + right
            page_start, page_end = _pages_for(cs, ce, offsets)
            chunks.append(Chunk(
                chunk_index=index,
                content=content,
                token_count=round(len(content) / CHARS_PER_TOKEN),
                page_start=page_start,
                page_end=page_end,
                char_start=cs,
                char_end=ce,
            ))
            index += 1

        if end >= n:
            break
        start = max(end - OVERLAP_CHARS, start + 1)

    return chunks


def _pages_for(char_start: int, char_end: int, offsets) -> tuple[int, int]:
    page_start = page_end = None
    for page_no, p_start, p_end in offsets:
        if p_end <= char_start or p_start >= char_end:
            continue
        if page_start is None:
            page_start = page_no
        page_end = page_no
    if page_start is None:  # chunk in inter-page whitespace only
        page_start = page_end = offsets[-1][0] if offsets else 1
    return page_start, page_end


# ---------------------------------------------------------------------------
# 4. Store (raw SQL — ingestion state, not the lifecycle)
# ---------------------------------------------------------------------------

def _resolve_subject(identifier: str) -> tuple[str, str]:
    with connection.cursor() as cur:
        cur.execute(
            'SELECT id, name FROM subjects WHERE id::text = %s OR slug = %s',
            [identifier, identifier],
        )
        row = cur.fetchone()
        if row is None:
            cur.execute(
                'SELECT id, name FROM subjects WHERE lower(name) = lower(%s) LIMIT 1',
                [identifier],
            )
            row = cur.fetchone()
    if row is None:
        raise CommandError(f'No subject matches {identifier!r} (uuid, slug or name)')
    return str(row[0]), row[1]


def _resolve_topic(identifier: str, subject_id: str) -> tuple[str, str]:
    with connection.cursor() as cur:
        cur.execute(
            """SELECT id, name FROM topics
               WHERE subject_id = %s AND (id::text = %s OR lower(name) = lower(%s))""",
            [subject_id, identifier, identifier],
        )
        row = cur.fetchone()
    if row is None:
        raise CommandError(f'No topic {identifier!r} under this subject')
    return str(row[0]), row[1]


def _resolve_uploader(identifier: str | None) -> str:
    """CLI has no request user; default to a lecturer, then admin, then any
    active user. `--uploaded-by` (uuid or email) overrides."""
    with connection.cursor() as cur:
        if identifier:
            cur.execute(
                'SELECT id FROM users WHERE id::text = %s OR lower(email) = lower(%s) LIMIT 1',
                [identifier, identifier],
            )
            row = cur.fetchone()
            if row is None:
                raise CommandError(f'No user matches {identifier!r} (uuid or email)')
            return str(row[0])
        for role in ('LECTURER', 'ADMIN'):
            cur.execute(
                """SELECT u.id FROM users u
                   JOIN user_roles r ON r.user_id = u.id
                   WHERE r.role = %s AND u.is_active
                   ORDER BY u.created_at LIMIT 1""",
                [role],
            )
            row = cur.fetchone()
            if row:
                return str(row[0])
        cur.execute('SELECT id FROM users WHERE is_active ORDER BY created_at LIMIT 1')
        row = cur.fetchone()
    if row is None:
        raise CommandError('No active user available for uploaded_by; pass --uploaded-by')
    return str(row[0])


def _delete_existing(subject_id: str, title: str) -> int:
    with connection.cursor() as cur:
        cur.execute(
            'DELETE FROM knowledge_documents WHERE subject_id = %s AND title = %s',
            [subject_id, title],
        )
        return cur.rowcount


def _insert_document(subject_id, topic_id, uploaded_by, title, file_path, mime_type, raw_text) -> str:
    with connection.cursor() as cur:
        cur.execute(
            """INSERT INTO knowledge_documents
                   (subject_id, topic_id, uploaded_by, title, file_path, mime_type,
                    raw_text, ingest_status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, 'PENDING')
               RETURNING id""",
            [subject_id, topic_id, uploaded_by, title, file_path, mime_type, raw_text],
        )
        return str(cur.fetchone()[0])


def _insert_chunks(document_id, subject_id, topic_id, chunks, vectors, batch_size) -> None:
    """Bulk-insert chunk rows, one committed statement per batch."""
    for start in range(0, len(chunks), batch_size):
        batch = chunks[start:start + batch_size]
        batch_vectors = vectors[start:start + batch_size]
        values_sql = ','.join(['(%s, %s, %s, %s, %s, %s, %s::vector, %s::jsonb)'] * len(batch))
        params: list = []
        for chunk, vec in zip(batch, batch_vectors):
            params.extend([
                document_id, subject_id, topic_id, chunk.chunk_index, chunk.content,
                chunk.token_count, vector_literal(vec), json.dumps(chunk.metadata),
            ])
        with connection.cursor() as cur:
            cur.execute(
                f"""INSERT INTO knowledge_chunks
                        (document_id, subject_id, topic_id, chunk_index, content,
                         token_count, embedding, metadata_json)
                    VALUES {values_sql}""",
                params,
            )


def _mark_ready(document_id: str, chunk_count: int, raw_text: str | None = None) -> None:
    with connection.cursor() as cur:
        cur.execute(
            """UPDATE knowledge_documents
               SET ingest_status = 'READY', chunk_count = %s, ingest_error = NULL,
                   raw_text = COALESCE(%s, raw_text)
               WHERE id = %s""",
            [chunk_count, raw_text, document_id],
        )


def _mark_failed(document_id: str, error: str) -> None:
    with connection.cursor() as cur:
        cur.execute(
            """UPDATE knowledge_documents
               SET ingest_status = 'FAILED', ingest_error = %s
               WHERE id = %s""",
            [error[:4000], document_id],
        )


# ---------------------------------------------------------------------------
# Pending-upload drain (POST /api/materials writes PENDING; this drains it)
# ---------------------------------------------------------------------------

def _resolve_stored_path(file_path: str) -> str:
    """Uploaded docs store a MEDIA_ROOT-relative path; CLI paths are absolute."""
    if os.path.isabs(file_path):
        return file_path
    return os.path.join(str(settings.MEDIA_ROOT), file_path)


def _select_pending() -> list[tuple]:
    with connection.cursor() as cur:
        cur.execute(
            """SELECT id, subject_id, topic_id, title, file_path, mime_type
               FROM knowledge_documents
               WHERE ingest_status = 'PENDING' AND file_path IS NOT NULL
               ORDER BY created_at"""
        )
        return cur.fetchall()


# ---------------------------------------------------------------------------
# Command
# ---------------------------------------------------------------------------

class Command(BaseCommand):
    help = 'Ingest a PDF/MD/TXT reference document into knowledge_documents/knowledge_chunks.'

    def add_arguments(self, parser):
        parser.add_argument('path', nargs='?', default=None,
                            help='Path to the source file (.pdf, .md, .txt)')
        parser.add_argument('--subject', default=None, help='Subject uuid, slug or name')
        parser.add_argument('--topic', default=None, help='Topic uuid or name (optional)')
        parser.add_argument('--title', default=None, help='Document title (default: filename stem)')
        parser.add_argument('--uploaded-by', default=None,
                            help='User uuid or email for uploaded_by (default: a lecturer)')
        parser.add_argument('--replace', action='store_true',
                            help='Delete an existing (subject_id, title) document first')
        parser.add_argument('--dry-run', action='store_true',
                            help='Extract + chunk + cost only; makes zero network calls')
        parser.add_argument('--limit-pages', default=None, help='Restrict to pages "A-B" (1-based)')
        parser.add_argument('--batch-size', type=int, default=64, help='Embed/insert batch size')
        parser.add_argument('--pending', action='store_true',
                            help='Ingest every PENDING uploaded document once, then exit')
        parser.add_argument('--loop', action='store_true',
                            help='With --pending: keep draining every --interval seconds')
        parser.add_argument('--interval', type=int, default=10,
                            help='Poll interval seconds for --pending --loop')

    def handle(self, *args, **options):
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s %(levelname)s %(name)s: %(message)s',
        )
        if options['pending'] or options['loop']:
            self._drain(options)
            return

        path = options['path']
        if not path:
            raise CommandError('Provide a <path> to ingest, or use --pending to drain uploads.')
        if not options['subject']:
            raise CommandError('--subject is required when ingesting a <path>.')
        if not os.path.exists(path):
            raise CommandError(f'File not found: {path}')
        if options['batch_size'] < 1:
            raise CommandError('--batch-size must be >= 1')

        subject_id, subject_name = _resolve_subject(options['subject'])
        topic_id, topic_name = (None, None)
        if options['topic']:
            topic_id, topic_name = _resolve_topic(options['topic'], subject_id)
        title = options['title'] or os.path.splitext(os.path.basename(path))[0]

        pages, mime_type = _read_pages(path)
        total_pages = len(pages)
        pages = _apply_page_limit(pages, options['limit_pages'])
        if not pages:
            raise CommandError('No pages left after --limit-pages filtering')

        running_heads = _collect_running_heads(pages)
        full_text, offsets = _build_document(pages, running_heads)
        chunks = _chunk_text(full_text, offsets)
        total_tokens = sum(c.token_count for c in chunks)
        cost = total_tokens / 1_000_000 * COST_PER_MILLION_TOKENS_USD

        if options['dry_run']:
            self._print_summary(
                path, subject_id, subject_name, topic_name, title, total_pages, len(pages),
                len(chunks), total_tokens, cost, document_id=None, dry_run=True,
            )
            return

        uploaded_by = _resolve_uploader(options['uploaded_by'])

        if options['replace']:
            deleted = _delete_existing(subject_id, title)
            if deleted:
                self.stdout.write(f'--replace: removed {deleted} existing document(s) for "{title}".')

        document_id = _insert_document(
            subject_id, topic_id, uploaded_by, title, os.path.abspath(path),
            mime_type, full_text,
        )

        try:
            vectors = embed_texts([c.content for c in chunks], batch_size=options['batch_size'])
            if len(vectors) != len(chunks):
                raise EmbeddingError(
                    f'Embedding count mismatch: {len(vectors)} vectors for {len(chunks)} chunks'
                )
            _insert_chunks(
                document_id, subject_id, topic_id, chunks, vectors, options['batch_size'],
            )
            _mark_ready(document_id, len(chunks))
        except Exception as e:  # noqa: BLE001 — any failure marks the doc FAILED
            logger.exception('Ingestion failed for %s', document_id)
            _mark_failed(document_id, f'{type(e).__name__}: {e}')
            raise CommandError(f'Ingestion failed (document {document_id} marked FAILED): {e}')

        self._print_summary(
            path, subject_id, subject_name, topic_name, title, total_pages, len(pages),
            len(chunks), total_tokens, cost, document_id=document_id, dry_run=False,
        )

    def _print_summary(self, path, subject_id, subject_name, topic_name, title,
                       total_pages, kept_pages, chunk_count, total_tokens, cost,
                       document_id, dry_run):
        if dry_run:
            self.stdout.write(self.style.WARNING(
                'DRY RUN — extraction + chunking only; no embeddings client constructed, no API call made.'
            ))
        else:
            self.stdout.write(self.style.SUCCESS(f'Ingested document {document_id} (status READY).'))
        self.stdout.write(f'  Source       : {path}')
        self.stdout.write(f'  Subject      : {subject_name} ({subject_id})')
        if topic_name:
            self.stdout.write(f'  Topic        : {topic_name}')
        self.stdout.write(f'  Title        : {title}')
        self.stdout.write(f'  Pages        : {kept_pages} of {total_pages} kept')
        self.stdout.write(f'  Chunks       : {chunk_count}')
        self.stdout.write(f'  Approx tokens: {total_tokens:,} (len/4 approximation)')
        self.stdout.write(f'  Est. cost    : ${cost:.6f} ({total_tokens}/1e6 * {COST_PER_MILLION_TOKENS_USD})')

    # -- Pending-upload drain -------------------------------------------------

    def _drain(self, options):
        """Process PENDING uploaded documents, oldest first, once (or looped).

        Per-document failure isolation: one corrupt document is marked FAILED
        with its error and the run (or loop) continues with the next.
        """
        while True:
            pending = _select_pending()
            if not pending:
                self.stdout.write('Nothing pending.')
                if not options['loop']:
                    return
                time.sleep(max(1, options['interval']))
                continue

            for row in pending:
                document_id = str(row[0])
                subject_id = str(row[1])
                topic_id = str(row[2]) if row[2] else None
                title = row[3]
                file_path = row[4]
                try:
                    chunk_count = self._ingest_pending_document(
                        document_id, subject_id, topic_id, file_path,
                        options['batch_size'],
                    )
                    self.stdout.write(self.style.SUCCESS(
                        f'{document_id} "{title}" -> READY ({chunk_count} chunks)'
                    ))
                except Exception as e:  # noqa: BLE001 — isolate per document
                    logger.exception('Pending ingest failed for %s', document_id)
                    _mark_failed(document_id, f'{type(e).__name__}: {e}')
                    self.stderr.write(f'{document_id} "{title}" -> FAILED: {e}')

            if not options['loop']:
                return
            time.sleep(max(1, options['interval']))

    def _ingest_pending_document(self, document_id, subject_id, topic_id, file_path, batch_size):
        resolved = _resolve_stored_path(file_path)
        if not os.path.exists(resolved):
            raise CommandError(f'File not found on disk: {file_path}')
        pages, _ = _read_pages(resolved)
        if not pages:
            raise CommandError('No pages extracted from document')
        running_heads = _collect_running_heads(pages)
        full_text, offsets = _build_document(pages, running_heads)
        chunks = _chunk_text(full_text, offsets)
        vectors = embed_texts([c.content for c in chunks], batch_size=batch_size)
        if len(vectors) != len(chunks):
            raise EmbeddingError(
                f'Embedding count mismatch: {len(vectors)} vectors for {len(chunks)} chunks'
            )
        _insert_chunks(document_id, subject_id, topic_id, chunks, vectors, batch_size)
        _mark_ready(document_id, len(chunks), raw_text=full_text)
        return len(chunks)
