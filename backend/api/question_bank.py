"""Parse a TOPIK 'Instrumen Tes Miskonsepsi IPA' .docx into question-bank rows.

The instrument is a Word table whose header row is::

    No | Tujuan Pembelajaran | Level Soal | No Soal | Soal | Jawaban | Alasan jawaban

which maps onto this app's schema as::

    Soal            -> QuestionVersion.prompt
    Jawaban         -> QuestionVersion.short_answer
    Alasan jawaban  -> QuestionVersion.model_answer

Pictures embedded in a row's cells are returned with that row: several questions
open with 'Perhatikan gambar berikut!', and the app renders an image appended to
the prompt as HTML (see `QuestionImportCreateView`).

Stdlib only — a .docx is a zip of XML.
"""
import re
import zipfile
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'

HEADER_MARKERS = ('TUJUAN PEMBELAJARAN', 'ALASAN JAWABAN')


def _rels(z):
    xml = z.read('word/_rels/document.xml.rels').decode('utf-8', 'replace')
    return {m.group(1): m.group(2) for m in
            re.finditer(r'Id="([^"]+)"[^>]*Target="([^"]+)"', xml)}


def _cell_text(tc):
    parts = []
    for p in tc.findall(f'{W}p'):
        t = ''.join(n.text or '' for n in p.iter(f'{W}t')).strip()
        parts.append(t)
    return '\n'.join(x for x in parts if x).strip()


def _cell_images(tc, relmap):
    out = []
    for blip in tc.iter(f'{A}blip'):
        rid = blip.get(f'{R}embed')
        if rid and rid in relmap:
            out.append(relmap[rid])
    return out


def parse_instrument_docx(path):
    """Return `(declared_topic, rows)`. Each row carries its pictures' bytes."""
    with zipfile.ZipFile(path) as z:
        relmap = _rels(z)
        root = ET.fromstring(z.read('word/document.xml'))
        body = root.find(f'{W}body')

        table = None
        for tbl in body.iter(f'{W}tbl'):
            # the table's FIRST row is the topic line; the header is row 2.
            for tr in tbl.findall(f'{W}tr')[:3]:
                hdr = [_cell_text(tc).upper() for tc in tr.findall(f'{W}tc')]
                if any(m in h for h in hdr for m in HEADER_MARKERS):
                    table = tbl
                    break
            if table is not None:
                break
        if table is None:
            raise ValueError(f'Instrument table not found in {path!r}.')

        trs = table.findall(f'{W}tr')
        hdr_idx = 0
        for i, tr in enumerate(trs[:3]):
            hdr = [_cell_text(tc).upper() for tc in tr.findall(f'{W}tc')]
            if any(m in h for h in hdr for m in HEADER_MARKERS):
                hdr_idx = i
                break

        # the declared topic: the row above the header, else the first cell
        declared_topic = ''
        if hdr_idx > 0:
            declared_topic = _cell_text(trs[hdr_idx - 1].findall(f'{W}tc')[0]) \
                if trs[hdr_idx - 1].findall(f'{W}tc') else ''

        rows = []
        for tr in trs[hdr_idx + 1:]:
            cells = tr.findall(f'{W}tc')
            vals = [_cell_text(tc) for tc in cells]
            if not any(v.strip() for v in vals):
                continue
            vals += [''] * (7 - len(vals))
            images, seen_media = [], set()
            for tc in cells:
                for media in _cell_images(tc, relmap):
                    # Dedupe per row. TOPIK 1 soal 1 embeds the SAME picture three times
                    # in one cell (3 blips -> one rId); it is a single Padat/Cair/Gas
                    # composite, so three copies would render the figure three times.
                    if media in seen_media:
                        continue
                    seen_media.add(media)
                    try:
                        data = z.read(f'word/{media}')
                    except KeyError:
                        continue
                    images.append({'name': media.rsplit('/', 1)[-1], 'data': data})
            rows.append({
                'no_obj': vals[0], 'tujuan': vals[1], 'level': vals[2],
                'no_soal': vals[3], 'soal': vals[4], 'jawaban': vals[5],
                'alasan': vals[6], 'images': images,
            })
    return declared_topic, rows


def row_problems(row):
    """Validation messages mirroring the app's own importer."""
    bad = []
    if not row['soal'].strip():
        bad.append('prompt kosong')
    if not row['jawaban'].strip():
        bad.append('short_answer kosong')
    if not row['alasan'].strip():
        bad.append('alasan kosong')
    return bad
