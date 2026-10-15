"""Parse a TOPIK 'Instrumen Tes Miskonsepsi IPA' .docx into question-bank rows.

The instrument is a Word table whose header maps onto this app's schema as::

    Soal            -> QuestionVersion.prompt
    Jawaban         -> QuestionVersion.short_answer
    Alasan jawaban  -> QuestionVersion.model_answer

The three source documents do NOT share a layout, so columns are resolved **by
header name, never by position**:

    TOPIK 1: No | Tujuan Pembelajaran | Level Soal | No Soal  | Soal | Jawaban | Alasan jawaban
    TOPIK 2: No | Tujuan Pembelajaran | No. Soal  | Level Soal | Soal | Jawaban | Alasan jawaban
    TOPIK 3: No | Tujuan Pembelajaran | No Soal   | Level Soal | Soal | Jawaban | Alasan

TOPIK 2 swaps `No. Soal` and `Level Soal`; TOPIK 3 says `Alasan`, not `Alasan
jawaban`; and TOPIK 2's instrument is SPLIT across two consecutive tables (the
continuation table carries no header of its own).

Pictures embedded in a row's cells are returned with that row: several questions
open with 'Perhatikan gambar berikut!', and the app renders an image appended to
the prompt as HTML (see `QuestionImportCreateView`). Figures are deduplicated per
row.

Stdlib only — a .docx is a zip of XML.
"""
import re
import zipfile
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'

# normalised header text -> canonical field
HEADER_ALIASES = {
    'no': 'no_obj',
    'tujuan pembelajaran': 'tujuan',
    'level soal': 'level',
    'no soal': 'no_soal',
    'no. soal': 'no_soal',
    'nomor soal': 'no_soal',
    'soal': 'soal',
    'pertanyaan': 'soal',
    'jawaban': 'jawaban',
    'jawaban singkat': 'jawaban',
    'alasan jawaban': 'alasan',
    'alasan': 'alasan',
}
REQUIRED = ('no_soal', 'soal', 'jawaban', 'alasan')
FIELDS = ('no_obj', 'tujuan', 'level', 'no_soal', 'soal', 'jawaban', 'alasan')


def _norm(text):
    return re.sub(r'\s+', ' ', (text or '').strip().lower()).rstrip('.').strip()


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


def _map_header(cells):
    """canonical field -> column index, resolved by name."""
    mapping = {}
    for idx, cell in enumerate(cells):
        canon = HEADER_ALIASES.get(_norm(cell))
        if canon and canon not in mapping:
            mapping[canon] = idx
    return mapping


def _find_header(tbl):
    """`(row_index, mapping)` for the first row that looks like an instrument header."""
    trs = tbl.findall(f'{W}tr')
    for i, tr in enumerate(trs[:4]):
        mapping = _map_header([_cell_text(tc) for tc in tr.findall(f'{W}tc')])
        if all(f in mapping for f in REQUIRED):
            return i, mapping
    return None, None


def parse_instrument_docx(path):
    """Return `(declared_topic, rows)`. Each row carries its pictures' bytes."""
    with zipfile.ZipFile(path) as z:
        relmap = _rels(z)
        root = ET.fromstring(z.read('word/document.xml'))
        body = root.find(f'{W}body')

        tables = list(body.iter(f'{W}tbl'))

        # ---- locate the instrument table ------------------------------------
        first_idx = hdr_idx = mapping = None
        for ti, tbl in enumerate(tables):
            hi, m = _find_header(tbl)
            if hi is not None:
                first_idx, hdr_idx, mapping = ti, hi, m
                break
        if first_idx is None:
            raise ValueError(f'Instrument table not found in {path!r}.')

        trs = tables[first_idx].findall(f'{W}tr')
        declared_topic = ''
        if hdr_idx > 0:
            cells = trs[hdr_idx - 1].findall(f'{W}tc')
            if cells:
                declared_topic = _cell_text(cells[0])

        n_cols = len(trs[hdr_idx].findall(f'{W}tc'))

        # ---- collect data rows, following split continuations ----------------
        # TOPIK 2's instrument continues in the NEXT table, which repeats no header.
        def rows_of(tbl, skip):
            return [tr.findall(f'{W}tc') for tr in tbl.findall(f'{W}tr')[skip:]
                    if tr.findall(f'{W}tc')]

        data_cells = rows_of(tables[first_idx], hdr_idx + 1)
        for tbl in tables[first_idx + 1:]:
            probe = tbl.findall(f'{W}tr')
            if not probe:
                break
            hi, _ = _find_header(tbl)
            if hi is not None:
                break                       # a new instrument starts; stop
            if len(probe[0].findall(f'{W}tc')) != n_cols:
                break                       # different shape -> unrelated table
            data_cells += rows_of(tbl, 0)

        # ---- read the rows ---------------------------------------------------
        rows = []
        for cells in data_cells:
            vals = [_cell_text(tc) for tc in cells]
            if not any(v.strip() for v in vals):
                continue
            row = {f: '' for f in FIELDS}
            for canon, idx in mapping.items():
                if idx < len(vals):
                    row[canon] = vals[idx]
            # a data row must carry a question number or question text
            if not (row['no_soal'].strip() or row['soal'].strip()):
                continue

            images, seen = [], set()
            for tc in cells:
                for media in _cell_images(tc, relmap):
                    # Dedupe per row: TOPIK 1 soal 1 embeds the SAME picture three
                    # times in one cell (3 blips -> one rId); it is a single
                    # Padat/Cair/Gas composite, so three copies would render thrice.
                    if media in seen:
                        continue
                    seen.add(media)
                    try:
                        data = z.read(f'word/{media}')
                    except KeyError:
                        continue
                    images.append({'name': media.rsplit('/', 1)[-1], 'data': data})
            row['images'] = images
            rows.append(row)
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
