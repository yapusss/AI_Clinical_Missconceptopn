"""Build the downloadable Word template for a TOPIK instrument.

The template mirrors `(TOPIK n) Instrumen Tes Miskonsepsi IPA ... .docx`: the same
title, `Topik:` line, `Cakupan materi` list, the `Review Miskonsepsi` table (headers
only) and the instrument table with the exact column names the importer resolves by
name. One example row demonstrates the accepted formula syntax: LaTeX between `$`
signs, which `api.question_bank.cell_to_html` turns into MathLive nodes.

Stdlib only, like the parser — a .docx is a zip of XML.
"""
import io
import zipfile
from xml.sax.saxutils import escape

W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

INSTRUMENT_HEADERS = (
    'No', 'Tujuan Pembelajaran', 'Level Soal', 'No Soal',
    'Soal', 'Jawaban', 'Alasan jawaban',
)
INSTRUMENT_WIDTHS = (600, 1700, 900, 700, 2600, 1500, 1500)
REVIEW_HEADERS = ('No', 'Cakupan konsep', 'Miskonsepsi', 'Konsep yang benar')
REVIEW_WIDTHS = (600, 2400, 3200, 3200)

EXAMPLE_ROW = (
    '1',
    'Mahasiswa mampu menerapkan hubungan kelajuan, jarak, dan waktu pada gerak lurus.',
    'C3',
    '1',
    'Sebuah benda menempuh jarak $s = 120$ m dalam waktu $t = 15$ s. '
    'Hitung kelajuan benda tersebut menggunakan $v = \\frac{s}{t}$.',
    '$v = 8$ m/s',
    'Kelajuan adalah jarak per satuan waktu, sehingga '
    '$v = \\frac{s}{t} = \\frac{120}{15} = 8$ m/s.',
)


def _run(text, bold=False, italic=False, size=None):
    props = []
    if bold:
        props.append('<w:b/><w:bCs/>')
    if italic:
        props.append('<w:i/><w:iCs/>')
    if size:
        props.append(f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>')
    rpr = f'<w:rPr>{"".join(props)}</w:rPr>' if props else ''
    return f'<w:r>{rpr}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def _para(runs, space_after=120):
    return ('<w:p><w:pPr><w:spacing w:after="%d"/></w:pPr>%s</w:p>'
            % (space_after, runs))


def _cell(text, width, bold=False, shade=None):
    tcpr = f'<w:tcW w:w="{width}" w:type="dxa"/>'
    if shade:
        tcpr += f'<w:shd w:val="clear" w:color="auto" w:fill="{shade}"/>'
    return (f'<w:tc><w:tcPr>{tcpr}</w:tcPr>'
            f'<w:p>{_run(text, bold=bold)}</w:p></w:tc>')


def _table(headers, rows, widths):
    grid = ''.join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    borders = ''.join(
        f'<w:{side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>'
        for side in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV')
    )
    out = [f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>'
           f'<w:tblBorders>{borders}</w:tblBorders></w:tblPr>'
           f'<w:tblGrid>{grid}</w:tblGrid>']
    out.append('<w:tr><w:trPr><w:tblHeader/></w:trPr>'
               + ''.join(_cell(h, w, bold=True, shade='D9E2F3')
                         for h, w in zip(headers, widths))
               + '</w:tr>')
    for row in rows:
        out.append('<w:tr>' + ''.join(_cell(v, w) for v, w in zip(row, widths))
                   + '</w:tr>')
    out.append('</w:tbl>')
    return ''.join(out)


def _document_xml():
    body = [
        _para(_run('Instrumen Tes Miskonsepsi IPA untuk Mahasiswa',
                   bold=True, size=28)),
        _para(_run('Topik: ', bold=True)
              + _run('Tulis topik materi di sini (mis. Kalor dan Perpindahan Kalor)')),
        _para(_run('Cakupan materi:', bold=True), space_after=60),
        _para(_run('• Cakupan materi pertama'), space_after=0),
        _para(_run('• Cakupan materi kedua'), space_after=60),
        _para(_run(
            'Petunjuk: satu file untuk satu topik. Jangan mengubah nama kolom. '
            'Rumus dapat ditulis sebagai LaTeX di antara tanda $...$ '
            '(contoh: $v = \\frac{s}{t}$) atau lewat Insert > Equation; '
            'keduanya dikonversi otomatis. Gambar boleh disisipkan langsung '
            'di sel Soal.', italic=True, size=18)),
        _para(_run('Review Miskonsepsi tiap cakupan materi', bold=True)),
        _table(REVIEW_HEADERS, [], REVIEW_WIDTHS),
        _para(_run('Instrumen Tes', bold=True)),
        _table(INSTRUMENT_HEADERS, [EXAMPLE_ROW], INSTRUMENT_WIDTHS),
        ('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
         '<w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" '
         'w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'),
    ]
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:document xmlns:w="{W_NS}" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
            'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
            '<w:body>' + ''.join(body) + '</w:body></w:document>')


CONTENT_TYPES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>'''

RELATIONSHIPS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>'''

DOCUMENT_RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'''

STYLES = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W_NS}">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>
<w:sz w:val="22"/><w:szCs w:val="22"/>
</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>'''

CORE = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Template Instrumen Tes Miskonsepsi IPA</dc:title>
<dc:creator>AI Clinical Misconception</dc:creator>
</cp:coreProperties>'''


def build_instrument_template():
    """Return the .docx bytes for the fill-in template."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', CONTENT_TYPES)
        archive.writestr('_rels/.rels', RELATIONSHIPS)
        archive.writestr('word/document.xml', _document_xml())
        archive.writestr('word/_rels/document.xml.rels', DOCUMENT_RELS)
        archive.writestr('word/styles.xml', STYLES)
        archive.writestr('docProps/core.xml', CORE)
    return buffer.getvalue()
