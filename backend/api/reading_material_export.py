"""Per-package reading-material PDF export (W2).

Two layers, deliberately separated:

* `render_reading_pdf(identity, sections)` is pure — no ORM, no request, no
  `connection`. It turns the already-collected identity/sections payload into a
  PDF byte string.
* `collect_export_sections(student, package_id)` performs the ORM reads and
  mirrors the student gate (`READY` rows only) of
  `views._student_reading_material`, keyed by the LECTURER's category.

The PDF contains identity, questions, reading material and the source list.
It deliberately never contains the student's answers, the verdict, the score or
the lecturer's feedback.
"""

import logging
import re
from zoneinfo import ZoneInfo

import pymupdf
from django.utils import timezone

logger = logging.getLogger(__name__)

_JAKARTA = ZoneInfo('Asia/Jakarta')

# A4, 40 pt margins. Body text must stop above the footer.
PAGE_RECT = pymupdf.paper_rect('a4')
MARGIN = 40.0
CONTENT_WIDTH = PAGE_RECT.width - (2 * MARGIN)
BODY_BOTTOM = PAGE_RECT.height - 52.0
HEADING_MIN_REMAINING = 60.0

# Base-14 fonts are Latin-1/WinAnsi only. Every inserted string goes through
# `_latin`, which first maps the common typographic characters to ASCII and
# then drops anything still outside Latin-1. A single unhandled em dash reaching
# `insert_text` is exactly the bug that looks like "PDF works, content missing".
_LATIN_MAP = {
    '\u2014': '-',   # em dash
    '\u2013': '-',   # en dash
    '\u2010': '-',   # hyphen
    '\u2011': '-',   # non-breaking hyphen
    '\u2012': '-',   # figure dash
    '\u2212': '-',   # minus sign
    '\u2018': "'",   # left single quote
    '\u2019': "'",   # right single quote
    '\u201a': "'",
    '\u201b': "'",
    '\u201c': '"',   # left double quote
    '\u201d': '"',   # right double quote
    '\u201e': '"',
    '\u201f': '"',
    '\u2026': '...',  # ellipsis
    '\u00a0': ' ',    # non-breaking space
    '\u2022': '-',    # bullet
    '\u2023': '-',
    '\u2043': '-',
    '\u00b7': '-',    # middle dot
    '\u2192': '->',
    '\u2190': '<-',
    '\u2265': '>=',
    '\u2264': '<=',
    '\u2260': '!=',
    '\u00d7': 'x',
}


def _latin(text) -> str:
    """Map typographic characters to ASCII and drop any remaining non-Latin-1."""
    value = str(text if text is not None else '')
    for source, replacement in _LATIN_MAP.items():
        value = value.replace(source, replacement)
    # Keep printable Latin-1 plus tab/space. Newlines are stripped here; callers
    # insert one line at a time.
    return ''.join(
        char for char in value
        if char in '\t ' or 32 <= ord(char) <= 255
    )


def _text_length(text, fontname, fontsize):
    return pymupdf.get_text_length(text, fontname=fontname, fontsize=fontsize)


def _wrap(text, fontname, fontsize, max_width):
    """Greedy word wrap, with a character-level fallback for an oversized word."""
    words = text.split()
    if not words:
        return []

    lines = []
    current = words[0]
    for word in words[1:]:
        candidate = f'{current} {word}'
        if _text_length(candidate, fontname, fontsize) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)

    wrapped = []
    for line in lines:
        while line and _text_length(line, fontname, fontsize) > max_width:
            low, high = 1, len(line)
            while low < high:
                middle = (low + high + 1) // 2
                if _text_length(line[:middle], fontname, fontsize) <= max_width:
                    low = middle
                else:
                    high = middle - 1
            wrapped.append(line[:low])
            line = line[low:]
        if line:
            wrapped.append(line)
    return wrapped


class _PdfWriter:
    """Small line-oriented layout engine over a PyMuPDF document."""

    def __init__(self):
        self.doc = pymupdf.open()
        self.page = None
        self.y = MARGIN

    def new_page(self):
        self.page = self.doc.new_page(
            width=PAGE_RECT.width, height=PAGE_RECT.height,
        )
        self.y = MARGIN

    def ensure_space(self, needed):
        if self.page is None or self.y + needed > BODY_BOTTOM:
            self.new_page()

    def gap(self, amount):
        if self.page is not None:
            self.y += amount
            if self.y > BODY_BOTTOM:
                self.new_page()

    def rule(self):
        self.ensure_space(6)
        self.page.draw_line(
            (MARGIN, self.y), (MARGIN + CONTENT_WIDTH, self.y),
            color=(0.72, 0.72, 0.72), width=0.6,
        )
        self.y += 8

    def heading(self, text, fontsize, *, gap_before=8.0, gap_after=5.0):
        # Never strand a heading at the page bottom.
        if self.page is not None and (BODY_BOTTOM - self.y) < HEADING_MIN_REMAINING:
            self.new_page()
        self.gap(gap_before)
        self.ensure_space(HEADING_MIN_REMAINING)
        self._write(text, fontname='hebo', fontsize=fontsize, indent=0.0)
        self.y += gap_after

    def paragraph(self, text, *, fontname='helv', fontsize=10.5, indent=0.0,
                  bullet=False, gap_after=4.0, line_height=1.42):
        text = _latin(text).strip()
        if not text:
            return
        text_x = MARGIN + indent + (12.0 if bullet else 0.0)
        width = CONTENT_WIDTH - indent - (12.0 if bullet else 0.0)
        lines = _wrap(text, fontname, fontsize, max(width, 20.0))
        for index, line in enumerate(lines):
            self.ensure_space(fontsize * line_height)
            if bullet and index == 0:
                self.page.insert_text(
                    (MARGIN + indent + 2.0, self.y), '-',
                    fontname='helv', fontsize=fontsize, color=(0, 0, 0),
                )
            self.page.insert_text(
                (text_x, self.y), line,
                fontname=fontname, fontsize=fontsize, color=(0, 0, 0),
            )
            self.y += fontsize * line_height
        self.y += gap_after

    def _write(self, text, *, fontname, fontsize, indent):
        text = _latin(text).strip()
        if not text:
            return
        width = CONTENT_WIDTH - indent
        for line in _wrap(text, fontname, fontsize, width):
            self.ensure_space(fontsize * 1.3)
            self.page.insert_text(
                (MARGIN + indent, self.y), line,
                fontname=fontname, fontsize=fontsize, color=(0, 0, 0),
            )
            self.y += fontsize * 1.3

    def add_footers(self):
        total = self.doc.page_count
        for index, page in enumerate(self.doc):
            label = f'hal. {index + 1}/{total}'
            width = _text_length(label, 'helv', 8)
            page.insert_text(
                (PAGE_RECT.width - MARGIN - width, PAGE_RECT.height - 24.0),
                label, fontname='helv', fontsize=8,
                color=(0.35, 0.35, 0.35),
            )


# --- Markdown -> typed lines -------------------------------------------------

_HEADING_RE = re.compile(r'^(#{1,6})\s+(.*)$')
_BULLET_RE = re.compile(r'^\s*[-*\u2022]\s+(.*)$')
_NUMBERED_RE = re.compile(r'^\s*(\d+)[.)]\s+(.*)$')
_TABLE_SEPARATOR_RE = re.compile(r'^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$')
_FENCE_RE = re.compile(r'^\s*```')


def _inline(text):
    """Strip inline Markdown emphasis/code markers, leaving plain text."""
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'__(.+?)__', r'\1', text)
    text = text.replace('`', '')
    return text.strip()


def _parse_markdown(markdown):
    """A deliberately small Markdown block parser.

    Returns `(kind, text)` tuples where kind is one of `h1`, `h2`, `h3`,
    `bullet`, `number`, `paragraph`, `table` or `code`. Tables and fenced code
    blocks flatten to plain lines: this renderer has no table layout and is not
    trying to grow one.
    """
    lines = str(markdown or '').replace('\r\n', '\n').replace('\r', '\n').split('\n')
    blocks = []
    paragraph = []
    in_fence = False
    fence_lines = []

    def flush_paragraph():
        if paragraph:
            blocks.append(('paragraph', ' '.join(paragraph)))
            paragraph.clear()

    for raw in lines:
        line = raw.strip()

        if _FENCE_RE.match(raw):
            flush_paragraph()
            in_fence = not in_fence
            if not in_fence:
                for fence_line in fence_lines:
                    if fence_line.strip():
                        blocks.append(('code', _inline(fence_line)))
                fence_lines = []
            continue
        if in_fence:
            fence_lines.append(raw.strip())
            continue

        if not line:
            flush_paragraph()
            continue

        heading = _HEADING_RE.match(line)
        if heading:
            flush_paragraph()
            level = min(len(heading.group(1)), 3)
            blocks.append((f'h{level}', _inline(heading.group(2))))
            continue

        bullet = _BULLET_RE.match(line)
        if bullet:
            flush_paragraph()
            blocks.append(('bullet', _inline(bullet.group(1))))
            continue

        numbered = _NUMBERED_RE.match(line)
        if numbered:
            flush_paragraph()
            blocks.append(('number', f'{numbered.group(1)}. {_inline(numbered.group(2))}'))
            continue

        # Tables flatten to "cell | cell" lines. A separator row (|---|---|)
        # carries no text and is dropped.
        if line.startswith('|') and line.endswith('|'):
            flush_paragraph()
            if not _TABLE_SEPARATOR_RE.match(line):
                cells = [cell.strip() for cell in line.strip('|').split('|')]
                blocks.append(('table', ' | '.join(cell for cell in cells if cell)))
            continue
        if _TABLE_SEPARATOR_RE.match(line) and '|' in line:
            flush_paragraph()
            continue

        if re.fullmatch(r'-{3,}|\*{3,}|_{3,}', line):
            flush_paragraph()
            continue

        paragraph.append(_inline(line))

    flush_paragraph()
    if in_fence:
        for fence_line in fence_lines:
            if fence_line.strip():
                blocks.append(('code', _inline(fence_line)))
    return blocks


def _render_markdown(writer, markdown):
    for kind, text in _parse_markdown(markdown):
        if kind == 'h1':
            writer.heading(text, 14.5, gap_before=10, gap_after=4)
        elif kind == 'h2':
            writer.heading(text, 12.5, gap_before=8, gap_after=3)
        elif kind == 'h3':
            writer.heading(text, 11.0, gap_before=6, gap_after=2)
        elif kind == 'bullet':
            writer.paragraph(text, indent=4.0, bullet=True, gap_after=2.5)
        elif kind == 'number':
            writer.paragraph(text, indent=4.0, gap_after=2.5)
        elif kind == 'table':
            # Flattened: no column layout is attempted.
            writer.paragraph(text, fontsize=10.0, gap_after=2.5)
        elif kind == 'code':
            # Flattened: no monospace block is attempted.
            writer.paragraph(text, fontsize=9.5, gap_after=1.5)
        else:
            writer.paragraph(text)


def _header_block(writer, identity):
    writer.ensure_space(HEADING_MIN_REMAINING)
    writer.heading('MATERI BACAAN', 20, gap_before=0, gap_after=8)
    rows = (
        ('Nama', identity.get('student_name')),
        ('NIM', identity.get('nim')),
        ('Mata Kuliah', identity.get('subject_name')),
        ('Paket', f"{identity.get('package_code') or ''} - "
                  f"{identity.get('package_title') or ''}"),
        ('Percobaan', identity.get('attempt_no')),
        ('Diunduh', identity.get('generated_at')),
    )
    for label, value in rows:
        writer.paragraph(f'{label} : {value if value is not None else ""}', gap_after=1.5)
    writer.rule()


def render_reading_pdf(identity, sections) -> bytes:
    """Render the exported identity + sections payload to PDF bytes.

    Pure: no database, no request. `identity` keys are `student_name`, `nim`,
    `package_code`, `package_title`, `subject_name`, `attempt_no`,
    `generated_at`. Each section is `{order, prompt, content_md, sources}` with
    `prompt` already plain text and `sources` items `{document_title, page}`.
    """
    writer = _PdfWriter()
    writer.ensure_space(1)
    _header_block(writer, identity or {})

    for section in sections or []:
        order = section.get('order')
        writer.heading(f'SOAL {order}', 15, gap_before=10, gap_after=5)
        writer.paragraph(section.get('prompt') or '', gap_after=5)

        writer.heading('MATERI BACAAN', 12, gap_before=3, gap_after=3)
        _render_markdown(writer, section.get('content_md') or '')

        writer.heading('SUMBER MATERI', 12, gap_before=5, gap_after=3)
        for source in section.get('sources') or []:
            if not isinstance(source, dict):
                continue
            title = _latin(source.get('document_title') or '').strip()
            page = source.get('page')
            line = title
            if page is not None:
                line = f'{line} - hal. {page}' if line else f'hal. {page}'
            writer.paragraph(line, bullet=True, fontsize=9.5, gap_after=1.5)

    writer.add_footers()
    data = writer.doc.tobytes(garbage=4, deflate=True)
    writer.doc.close()
    return data


# --- Collection --------------------------------------------------------------

def _identity_for(student, package, attempt_no):
    return {
        'student_name': student.full_name or '',
        'nim': student.nim or '',
        'package_code': package.code or '',
        'package_title': package.title or '',
        'subject_name': package.subject.name if package.subject_id else '',
        'attempt_no': attempt_no,
        'generated_at': timezone.localtime(timezone.now(), _JAKARTA).strftime(
            '%d-%m-%Y %H:%M'
        ),
    }


def collect_export_sections(student, package_id):
    """Collect `(identity, sections)` for one student's package.

    Returns `(None, [])` when the package does not exist or the student never
    submitted to it (the view answers 404). When the package is the student's
    but no validated answer has `READY` material, the identity is returned with
    an empty `sections` list (the view answers 409).

    Mirrors `views._student_reading_material`: only `READY` rows are served, and
    the category is the LECTURER's when a validation exists.
    """
    # Imported here so the renderer above stays importable without the app
    # registry (and heavy LLM module) loaded.
    from api.llm import strip_html_collapse
    from api.models import (
        ExamPackage,
        ExamPackageQuestion,
        GeneratedReadingMaterial,
        LlmAnalysis,
        Submission,
        Validation,
    )
    from api.reading_materials import lecturer_category

    package = ExamPackage.objects.filter(pk=package_id).select_related('subject').first()
    if package is None:
        return None, []

    items = list(
        ExamPackageQuestion.objects.filter(exam_package=package)
        .select_related('question_version')
        .order_by('order_index')
    )
    if not items:
        return None, []

    version_ids = [item.question_version_id for item in items]
    submissions = list(
        Submission.objects.filter(
            student=student,
            exam_package_id=package.id,
            question_version_id__in=version_ids,
        ).order_by('question_version_id', '-attempt_no')
    )
    if not submissions:
        # A package the student never submitted to is not theirs.
        return None, []

    latest_by_version = {}
    for submission in submissions:
        latest_by_version.setdefault(submission.question_version_id, submission)

    sections = []
    included_attempts = []

    for item in items:
        submission = latest_by_version.get(item.question_version_id)
        if submission is None or submission.status != 'VALIDATED':
            continue

        analysis = LlmAnalysis.objects.filter(
            submission_id=submission.id, is_current=True
        ).first()
        if analysis is None:
            continue
        validation = Validation.objects.filter(analysis=analysis).first()
        if validation is None:
            continue

        final_percentage = validation.final_percentage
        if final_percentage is None:
            final_percentage = analysis.percentage_correct
        # A "Benar" verdict has no material by design.
        if final_percentage is not None and float(final_percentage) >= 99.9:
            continue

        category = lecturer_category(
            analysis,
            validation.final_tier_level_snapshot,
            getattr(validation, 'final_category', None),
        )
        if not category or category == 'SC':
            continue

        material = GeneratedReadingMaterial.objects.filter(
            question_version_id=item.question_version_id,
            category=category,
            status='READY',
        ).first()
        if material is None:
            continue

        sources = []
        for source in material.sources_json or []:
            if not isinstance(source, dict):
                continue
            sources.append({
                'document_title': source.get('document_title') or '',
                'page': source.get('page'),
            })

        version = item.question_version
        sections.append({
            'order': item.order_index,
            'prompt': strip_html_collapse(version.prompt),
            'content_md': material.content_md or '',
            'sources': sources,
        })
        included_attempts.append(submission.attempt_no)

    attempt_no = max(included_attempts) if included_attempts else 1
    return _identity_for(student, package, attempt_no), sections


def build_export_pdf(student, package_id):
    """Collect and render. Returns `(pdf_bytes, '')` or `(None, reason)`.

    `reason` is `'not_found'` when the package is not the student's and
    `'empty'` when there is nothing ready to render.
    """
    identity, sections = collect_export_sections(student, package_id)
    if identity is None:
        return None, 'not_found'
    if not sections:
        return None, 'empty'
    return render_reading_pdf(identity, sections), ''
