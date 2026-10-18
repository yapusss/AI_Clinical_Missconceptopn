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

Equations are stored by Word as OMML, which is why an XLSX conversion loses them.
They are converted to LaTeX and inlined as `$...$` spans; `cell_to_html` turns
those into the `<math-field>` nodes the editor uses. LaTeX typed directly in a
cell (`$v = \\frac{s}{t}$`) is preserved as-is.

Stdlib only — a .docx is a zip of XML.
"""
import html
import re
import zipfile
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
M = '{http://schemas.openxmlformats.org/officeDocument/2006/math}'

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
        t = _paragraph_text(p)
        parts.append(t)
    return '\n'.join(x for x in parts if x).strip()


_MATH_ESCAPES = {
    '\\': r'\backslash ', '{': r'\{', '}': r'\}', '%': r'\%',
    '&': r'\&', '#': r'\#', '$': r'\$',
}
_NARY = {
    '∑': r'\sum', '∏': r'\prod', '∫': r'\int', '∬': r'\iint',
    '∭': r'\iiint', '∮': r'\oint', '⋃': r'\bigcup', '⋂': r'\bigcap',
}
_ACCENTS = {
    '\u0302': r'\hat', '\u0304': r'\bar', '\u20d7': r'\vec',
    '\u0307': r'\dot', '\u0308': r'\ddot', '\u0301': r'\acute',
    '\u0300': r'\grave', '\u030c': r'\check',
}


def _math_text(text):
    return ''.join(_MATH_ESCAPES.get(ch, ch) for ch in (text or ''))


def _child_latex(node, tag):
    child = node.find(tag)
    return _omml_latex(child) if child is not None else ''


def _omml_latex(node):
    """OMML element -> LaTeX string."""
    tag = node.tag
    if not isinstance(tag, str) or tag.endswith('Pr'):
        return ''
    if tag == f'{M}t':
        return _math_text(node.text)
    if tag in (f'{M}oMath', f'{M}oMathPara', f'{M}e', f'{M}num', f'{M}den',
               f'{M}sub', f'{M}sup', f'{M}deg', f'{M}lim', f'{M}fName'):
        return ''.join(_omml_latex(child) for child in node)
    if tag == f'{M}f':
        return r'\frac{%s}{%s}' % (_child_latex(node, f'{M}num'),
                                   _child_latex(node, f'{M}den'))
    if tag == f'{M}sSup':
        base = _child_latex(node, f'{M}e')
        sup = _child_latex(node, f'{M}sup')
        return f'{base}^{{{sup}}}'
    if tag == f'{M}sSub':
        base = _child_latex(node, f'{M}e')
        sub = _child_latex(node, f'{M}sub')
        return f'{base}_{{{sub}}}'
    if tag == f'{M}sSubSup':
        base = _child_latex(node, f'{M}e')
        sub = _child_latex(node, f'{M}sub')
        sup = _child_latex(node, f'{M}sup')
        return f'{base}_{{{sub}}}^{{{sup}}}'
    if tag == f'{M}sPre':
        base = _child_latex(node, f'{M}e')
        sub = _child_latex(node, f'{M}sub')
        sup = _child_latex(node, f'{M}sup')
        return f'{{}}_{{{sub}}}^{{{sup}}}{base}'
    if tag == f'{M}rad':
        body = _child_latex(node, f'{M}e')
        degree = _child_latex(node, f'{M}deg').strip()
        return r'\sqrt[%s]{%s}' % (degree, body) if degree else r'\sqrt{%s}' % body
    if tag == f'{M}d':
        pr = node.find(f'{M}dPr')
        beg, end = '(', ')'
        if pr is not None:
            beg_el, end_el = pr.find(f'{M}begChr'), pr.find(f'{M}endChr')
            if beg_el is not None:
                beg = beg_el.get(f'{M}val', '')
            if end_el is not None:
                end = end_el.get(f'{M}val', '')
        content = ''.join(_omml_latex(child) for child in node.findall(f'{M}e'))
        if not content:
            return ''
        return r'\left%s%s\right%s' % (beg or '.', content, end or '.')
    if tag == f'{M}nary':
        pr = node.find(f'{M}naryPr')
        char = '∫'
        if pr is not None:
            chr_el = pr.find(f'{M}chr')
            if chr_el is not None:
                char = chr_el.get(f'{M}val', char)
        out = _NARY.get(char, char)
        sub = _child_latex(node, f'{M}sub')
        sup = _child_latex(node, f'{M}sup')
        if sub:
            out += '_{%s}' % sub
        if sup:
            out += '^{%s}' % sup
        body = _child_latex(node, f'{M}e')
        return f'{out} {body}' if body else out
    if tag == f'{M}bar':
        pr = node.find(f'{M}barPr')
        pos = 'top'
        if pr is not None and pr.find(f'{M}pos') is not None:
            pos = pr.find(f'{M}pos').get(f'{M}val', 'top')
        body = _child_latex(node, f'{M}e')
        return (r'\underline{%s}' if pos == 'bot' else r'\overline{%s}') % body
    if tag == f'{M}acc':
        pr = node.find(f'{M}accPr')
        char = '\u0302'
        if pr is not None and pr.find(f'{M}chr') is not None:
            char = pr.find(f'{M}chr').get(f'{M}val', char)
        command = _ACCENTS.get(char, r'\hat')
        return f'{command}{{{_child_latex(node, f"{M}e")}}}'
    if tag == f'{M}limLow':
        base = _child_latex(node, f'{M}e')
        lim = _child_latex(node, f'{M}lim')
        return f'{base}_{{{lim}}}'
    if tag == f'{M}limUpp':
        base = _child_latex(node, f'{M}e')
        lim = _child_latex(node, f'{M}lim')
        return f'{base}^{{{lim}}}'
    if tag == f'{M}groupChr':
        pr = node.find(f'{M}groupChrPr')
        char = ''
        if pr is not None and pr.find(f'{M}chr') is not None:
            char = pr.find(f'{M}chr').get(f'{M}val', '')
        body = _child_latex(node, f'{M}e')
        if char == '\u23df':          # under-brace
            return r'\underbrace{%s}' % body
        if char == '\u23de':          # over-brace
            return r'\overbrace{%s}' % body
        return body
    return ''.join(_omml_latex(child) for child in node)


def _inline_text(node):
    """Text of an inline element, with equations emitted as `$latex$` spans."""
    tag = node.tag
    if not isinstance(tag, str):
        return ''
    if tag == f'{W}t':
        return node.text or ''
    if tag in (f'{M}oMath', f'{M}oMathPara'):
        latex = _omml_latex(node).strip()
        return f'${latex}$' if latex else ''
    if tag == f'{W}tab':
        return ' '
    if tag in (f'{W}br', f'{W}cr'):
        return '\n'
    if tag == f'{W}noBreakHyphen':
        return '-'
    if tag.endswith('Pr'):
        return ''
    return ''.join(_inline_text(child) for child in node)


def _paragraph_text(p):
    text = ''.join(_inline_text(child) for child in p)
    return re.sub(r'[ \t]+', ' ', text).strip()


MATH_SPAN_RE = re.compile(r'\$([^$\n]+)\$')
GENERIC_TITLE_RE = re.compile(r'^\s*instrumen\s+tes\s+miskonsepsi', re.IGNORECASE)
TOPIC_LABEL_RE = re.compile(r'^\s*(?:topik|topic)\s*[:.]\s*(.+)$', re.IGNORECASE)
TOPIC_LABEL_ONLY_RE = re.compile(r'^\s*(?:topik|topic)\s*[:.]?\s*$', re.IGNORECASE)
TOPIC_NUMBERED_RE = re.compile(r'^\s*topik\s+\d+\s*[.):\-]\s*(.+)$', re.IGNORECASE)
CAKUPAN_RE = re.compile(r'\bcakupan\s+materi\b.*$', re.IGNORECASE)


def has_math(text):
    return bool(MATH_SPAN_RE.search(text or ''))


def _visible_math_text(text):
    """`$\\frac{a}{b}$` -> `\\frac{a}{b}` for places that cannot render HTML."""
    return MATH_SPAN_RE.sub(lambda m: m.group(1).strip(), text or '')


def _html_text(text):
    escaped = html.escape(text or '', quote=False)
    return (escaped.replace('\r\n', '\n').replace('\r', '\n')
            .replace('\n', '<br />'))


def cell_to_html(text):
    """Escape cell text and turn `$latex$` spans into read-only MathLive nodes.

    The app's editor stores formulas as `<math-field>` elements whose text content
    is LaTeX, so imported formulas render exactly like hand-typed ones.
    """
    out, last = [], 0
    for match in MATH_SPAN_RE.finditer(text or ''):
        out.append(_html_text(text[last:match.start()]))
        out.append('<math-field read-only>%s</math-field>'
                   % html.escape(match.group(1).strip(), quote=False))
        last = match.end()
    out.append(_html_text((text or '')[last:]))
    return ''.join(out)


def cell_to_paragraphs(text):
    """One `<p>` per source line, so Word paragraph breaks stay readable.

    Word cells hold several paragraphs ("Diketahui:", each known value, each
    step). Joining them with `<br />` works, but separate paragraphs keep the
    spacing the lecturer wrote and read much better in the editor.
    """
    normalized = (text or '').replace('\r\n', '\n').replace('\r', '\n')
    lines = [line for line in normalized.split('\n') if line.strip()]
    if not lines:
        return '<p></p>'
    return ''.join(f'<p>{cell_to_html(line)}</p>' for line in lines)


def needs_rich_html(text):
    """True when plain storage would lose something (newlines or formulas)."""
    return has_math(text) or '\n' in (text or '')


def detect_document_topic(root):
    """Topic declared in the document intro (before the first table).

    The three TOPIK files declare it three different ways:

        TOPIK 1: 'Topik: Ruang antarpartikel - ...'
        TOPIK 2: 'Perubahan Wujud dan kekekalan massa - ...'   (bare bold line)
        TOPIK 3: 'TOPIK 3. Kalor dan Perpindahan Kalor'
    """
    body = root.find(f'{W}body')
    if body is None:
        return ''
    paragraphs = [_paragraph_text(p) for p in body.findall(f'{W}p')]
    for index, text in enumerate(paragraphs):
        if not text:
            continue
        match = TOPIC_LABEL_RE.match(text)
        if match:
            return _clean_topic(match.group(1))
        if TOPIC_LABEL_ONLY_RE.match(text):
            for follow in paragraphs[index + 1:index + 4]:
                value = _clean_topic(follow)
                if not value:
                    continue
                if CAKUPAN_RE.match(follow) or follow.lower().startswith('cakupan materi'):
                    break
                return value
            continue
        match = TOPIC_NUMBERED_RE.match(text)
        if match:
            return _clean_topic(match.group(1))
        if GENERIC_TITLE_RE.match(text):
            continue
        if CAKUPAN_RE.match(text) or text.lower().startswith('cakupan materi'):
            continue
        return _clean_topic(text)
    return ''


def _clean_topic(text):
    text = CAKUPAN_RE.sub('', text or '')
    text = re.sub(r'^\s*topik\s+\d+\s*[.):\-]\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s+', ' ', text).strip()
    return text.strip(' -–—:;"\'')



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
        declared_topic = detect_document_topic(root)
        if not declared_topic and hdr_idx > 0:
            cells = trs[hdr_idx - 1].findall(f'{W}tc')
            if cells:
                declared_topic = _clean_topic(_visible_math_text(_cell_text(cells[0])))

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
