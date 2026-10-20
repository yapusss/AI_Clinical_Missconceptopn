"""Builders for small synthetic .docx files used by the import tests.

The real TOPIK files are large and live outside the repository, so the tests
compose the exact document shapes they need: a header row, merged cells, a
legacy section, a second instrument, and so on.
"""
import html
import tempfile
import uuid
import zipfile
from pathlib import Path

W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

INSTRUMENT_HEADER = [
    'No', 'Tujuan Pembelajaran', 'No Soal', 'Level Soal',
    'Soal', 'Jawaban', 'Alasan jawaban',
]


def para(text):
    return f'<w:p><w:r><w:t xml:space="preserve">{html.escape(text)}</w:t></w:r></w:p>'


def cell(text, span=1):
    span_xml = f'<w:gridSpan w:val="{span}"/>' if span > 1 else ''
    return (
        '<w:tc><w:tcPr>' + span_xml + '</w:tcPr>'
        f'<w:p><w:r><w:t xml:space="preserve">{html.escape(text)}</w:t></w:r></w:p></w:tc>'
    )


def row(cells):
    return '<w:tr>' + ''.join(cells) + '</w:tr>'


def table(rows):
    return '<w:tbl>' + ''.join(row(cells) for cells in rows) + '</w:tbl>'


def instrument_row(no='1', level='C4', soal='Soal', jawaban='Jawaban',
                   alasan='Alasan', tujuan='Tujuan'):
    """One data row in the canonical instrument column order."""
    return [cell(''), cell(tujuan), cell(no), cell(level), cell(soal),
            cell(jawaban), cell(alasan)]


def nested_table(rows):
    """A table that will live inside a single cell."""
    return table([[cell(value) for value in row] for row in rows])


def cell_with_table(text, rows):
    """A cell that holds a paragraph plus an embedded table."""
    paragraph = ''
    if text:
        paragraph = (
            '<w:p><w:r><w:t xml:space="preserve">'
            f'{html.escape(text)}</w:t></w:r></w:p>'
        )
    return f'<w:tc><w:tcPr></w:tcPr>{paragraph}{nested_table(rows)}</w:tc>'


def review_table():    return table([
        [cell('No.'), cell('Miskonsepsi'), cell('Konsep benar')],
        [cell('1'), cell('Miskonsepsi A'), cell('Konsep A')],
    ])


def write_docx(blocks):
    """Write a minimal .docx and return its path (caller deletes it)."""
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W_NS}" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<w:body>' + ''.join(blocks) + '</w:body></w:document>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '</Relationships>'
    )
    path = Path(tempfile.gettempdir()) / f'instrument-fixture-{uuid.uuid4().hex}.docx'
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('word/document.xml', document)
        archive.writestr('word/_rels/document.xml.rels', rels)
    return path


def docx_bytes(blocks):
    path = write_docx(blocks)
    try:
        return path.read_bytes()
    finally:
        path.unlink()


def instrument_document(rows, topic='Kalor dan Perpindahan Kalor', extra=None,
                        extra_before=None):
    """A labelled topic, one instrument table, and optional extra blocks."""
    header = [[cell(name) for name in INSTRUMENT_HEADER]]
    return ([para(f'Topik: {topic}')]
            + list(extra_before or [])
            + [table(header + rows)]
            + list(extra or []))
