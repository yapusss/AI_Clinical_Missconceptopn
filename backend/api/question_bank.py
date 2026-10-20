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
import difflib
import html
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

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

# Human names used in the warnings a lecturer sees.
HUMAN_FIELDS = {
    'no_obj': 'No',
    'tujuan': 'Tujuan Pembelajaran',
    'level': 'Level Soal',
    'no_soal': 'No Soal',
    'soal': 'Soal',
    'jawaban': 'Jawaban',
    'alasan': 'Alasan jawaban',
}


class InstrumentParseError(ValueError):
    """A .docx import failure that can be shown to the lecturer.

    `detail` is the one-line summary; `issues` locates each problem by table,
    row and question number so the lecturer knows exactly what to fix.
    """

    def __init__(self, code, detail, issues=None):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.issues = list(issues or [])

    def as_payload(self):
        return {'detail': self.detail, 'issues': self.issues}


@dataclass
class InstrumentParse:
    """Result of a successful .docx parse, with everything worth reporting."""

    topic: str
    rows: list
    warnings: list = field(default_factory=list)
    topic_source: str = ''


def _issue(code, message, table=None, row=None, label=''):
    location = {}
    if table is not None:
        location['table'] = table
    if row is not None:
        location['row'] = row
    if label:
        location['label'] = label
    return {'code': code, 'message': message, 'location': location}


def _join_names(items):
    items = list(items)
    if not items:
        return ''
    if len(items) == 1:
        return f'"{items[0]}"'
    return ', '.join(f'"{item}"' for item in items[:-1]) + f' dan "{items[-1]}"'



def _norm(text):
    return re.sub(r'\s+', ' ', (text or '').strip().lower()).rstrip('.').strip()


def _rels(z):
    xml = z.read('word/_rels/document.xml.rels').decode('utf-8', 'replace')
    return {m.group(1): m.group(2) for m in
            re.finditer(r'Id="([^"]+)"[^>]*Target="([^"]+)"', xml)}


def _plain_cell_text(tc):
    """Cell text collapsed to one line, nested tables included."""
    parts = []
    for child in tc:
        if child.tag == f'{W}p':
            text = _paragraph_text(child)
            if text:
                parts.append(text)
        elif child.tag == f'{W}tbl':
            text = _nested_table_text(child)
            if text:
                parts.append(text)
    return re.sub(r'\s+', ' ', ' '.join(parts)).strip()


def _nested_table_text(tbl):
    """Render a table embedded in a cell as one `a | b | c` line per row."""
    lines = []
    for tr in tbl.findall(f'{W}tr'):
        cells = [_plain_cell_text(tc) for tc in tr.findall(f'{W}tc')]
        while cells and not cells[-1]:
            cells.pop()
        while cells and not cells[0]:
            cells.pop(0)
        if cells:
            lines.append(' | '.join(cells))
    return '\n'.join(lines)


def _cell_text(tc):
    """Cell text in document order, including tables embedded in the cell.

    Word allows a table inside a table cell. Reading only the direct <w:p>
    children silently dropped the experiment-data tables that questions and
    answers refer to (TOPIK 2 soal 7/13/…, TOPIK 3 soal 9/14/15), so nested
    tables are flattened to one `a | b` line per row instead.
    """
    parts = []
    for child in tc:
        if child.tag == f'{W}p':
            text = _paragraph_text(child)
            if text:
                parts.append(text)
        elif child.tag == f'{W}tbl':
            text = _nested_table_text(child)
            if text:
                parts.append(text)
    return '\n'.join(parts).strip()


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


def detect_document_topic_info(root):
    """`(topic, source, explicit_topics)` for the document intro.

    `source` is 'label' when the document says `Topik: ...` / `TOPIK 3. ...`,
    'paragraph' when the first non-boilerplate line is used instead, and ''
    when nothing was found. `explicit_topics` lists every labelled topic so a
    file declaring two of them can be rejected instead of silently importing
    only the first.

    The three TOPIK files declare it three different ways:

        TOPIK 1: 'Topik: Ruang antarpartikel - ...'
        TOPIK 2: 'Perubahan Wujud dan kekekalan massa - ...'   (bare bold line)
        TOPIK 3: 'TOPIK 3. Kalor dan Perpindahan Kalor'
    """
    body = root.find(f'{W}body')
    if body is None:
        return '', '', []
    paragraphs = [_paragraph_text(p) for p in body.findall(f'{W}p')]
    topic, source, explicit = '', '', []

    def take(value, kind):
        nonlocal topic, source
        value = _clean_topic(value)
        if not value:
            return
        if kind == 'label':
            explicit.append(value)
        if not topic:
            topic, source = value, kind

    for index, text in enumerate(paragraphs):
        if not text:
            continue
        match = TOPIC_LABEL_RE.match(text)
        if match:
            take(match.group(1), 'label')
            continue
        if TOPIC_LABEL_ONLY_RE.match(text):
            for follow in paragraphs[index + 1:index + 4]:
                value = _clean_topic(follow)
                if not value:
                    continue
                if CAKUPAN_RE.match(follow) or follow.lower().startswith('cakupan materi'):
                    break
                take(value, 'label')
                break
            continue
        match = TOPIC_NUMBERED_RE.match(text)
        if match:
            take(match.group(1), 'label')
            continue
        if GENERIC_TITLE_RE.match(text):
            continue
        if CAKUPAN_RE.match(text) or text.lower().startswith('cakupan materi'):
            continue
        take(text, 'paragraph')
    return topic, source, explicit


def detect_document_topic(root):
    return detect_document_topic_info(root)[0]


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


def _grid_span(tc):
    pr = tc.find(f'{W}tcPr')
    if pr is None:
        return 1
    span = pr.find(f'{W}gridSpan')
    if span is None:
        return 1
    try:
        return max(1, int(span.get(f'{W}val', '1')))
    except (TypeError, ValueError):
        return 1


def _row_grid(tr):
    """One entry per GRID column, so merged cells do not shift later columns.

    Word stores a horizontally merged cell as one <w:tc> with gridSpan=N. Mapping
    columns by <w:tc> position therefore pushes every later cell into the wrong
    field (a merged Soal/Jawaban/Alasan cell lands entirely in `soal`). Expanding
    to the real grid keeps the column order honest; covered columns read ''.
    """
    grid = []
    for tc in tr.findall(f'{W}tc'):
        start = len(grid)
        span = _grid_span(tc)
        text = _cell_text(tc)
        grid.append({'text': text, 'start': start, 'span': span, 'tc': tc})
        for _ in range(span - 1):
            grid.append({'text': '', 'start': start, 'span': span, 'tc': tc})
    return grid


def _cells(grid):
    """One entry per distinct cell, in grid order."""
    seen = set()
    for cell in grid:
        if cell['start'] in seen:
            continue
        seen.add(cell['start'])
        yield cell


def _find_header(tbl):
    """`(row_index, mapping)` for the first row that looks like an instrument header."""
    trs = tbl.findall(f'{W}tr')
    for i, tr in enumerate(trs[:4]):
        mapping = _map_header([cell['text'] for cell in _row_grid(tr)])
        if all(f in mapping for f in REQUIRED):
            return i, mapping
    return None, None


def _best_header_attempt(tbl):
    """`(score, row_index, mapping, cells)` for the closest header candidate."""
    best = None
    for i, tr in enumerate(tbl.findall(f'{W}tr')[:4]):
        cells = [cell['text'] for cell in _row_grid(tr)]
        mapping = _map_header(cells)
        score = len([f for f in REQUIRED if f in mapping])
        if best is None or score > best[0]:
            best = (score, i, mapping, cells)
    return best


def _suggest_header(cells, field):
    """Closest misspelled header cell for a missing column, or ''."""
    known = set(HEADER_ALIASES)
    wanted = _norm(HUMAN_FIELDS[field])
    best, best_ratio = '', 0.0
    for cell in cells:
        candidate = _norm(cell)
        if not candidate or candidate in known:
            continue
        ratio = difflib.SequenceMatcher(None, wanted, candidate).ratio()
        if ratio > best_ratio:
            best, best_ratio = cell, ratio
    return best if best_ratio >= 0.6 else ''


def _no_header_error(tables):
    """Explain why no instrument table was found, table by table."""
    best = None
    for _pos, tbl, number in tables:
        attempt = _best_header_attempt(tbl)
        if attempt and (best is None or attempt[0] > best[0]):
            best = (attempt[0], number, attempt[1], attempt[2], attempt[3])

    if best and best[0] >= 2:
        _score, number, row_index, mapping, cells = best
        issues = []
        for field_name in [f for f in REQUIRED if f not in mapping]:
            message = (f'Tabel {number} baris {row_index + 1}: kolom '
                       f'"{HUMAN_FIELDS[field_name]}" tidak ditemukan.')
            suggestion = _suggest_header(cells, field_name)
            if suggestion:
                message += (f' Sel "{suggestion}" mirip dengannya — '
                            'periksa ejaan header.')
            issues.append(_issue('header_missing', message,
                                 table=number, row=row_index + 1))
        detail = ('Header tabel instrumen belum lengkap. Kolom wajib: '
                  + ', '.join(HUMAN_FIELDS[f] for f in REQUIRED) + '.')
        return InstrumentParseError('header_missing', detail, issues)

    issues = []
    for _pos, tbl, number in tables[:6]:
        trs = tbl.findall(f'{W}tr')
        cells = [cell['text'] for cell in _row_grid(trs[0])] if trs else []
        shown = ', '.join(c.strip() for c in cells if c.strip())[:120] or '(kosong)'
        issues.append(_issue('table_not_instrument',
                             f'Tabel {number} (baris 1): {shown}',
                             table=number, row=1))
    detail = ('Tabel instrumen tidak ditemukan. Pastikan ada tabel dengan header '
              'No Soal, Soal, Jawaban, dan Alasan jawaban.')
    return InstrumentParseError('no_instrument_table', detail, issues)


def _preceding_text(blocks, position):
    """Nearest non-empty paragraph before `blocks[position]`."""
    for index in range(position - 1, -1, -1):
        if blocks[index].tag != f'{W}p':
            continue
        text = _paragraph_text(blocks[index])
        if text:
            return text
    return ''


FIELD_MARKER_RE = re.compile(
    r'(?im)^[ \t]*(?P<name>jawaban|alasan(?:\s+jawaban)?)[ \t]*:[ \t]*')

LEVEL_VALUE_RE = re.compile(r'^\s*C\s*\d', re.IGNORECASE)
NUMBER_VALUE_RE = re.compile(r'^\s*\d+\s*(?:[.\-–—]\s*\d+)?\s*$')
ANSWER_FIELDS = ('soal', 'jawaban', 'alasan')


def _looks_like_level(value):
    return bool(LEVEL_VALUE_RE.match(value or ''))


def _labels_are_swapped(no_soal, level):
    """True when the two middle columns clearly hold each other's values.

    `Level Soal` is always a cognitive level (C4). A bare number there, or a
    C-level inside `No Soal`, only happens when the document's columns drifted.
    """
    no_soal, level = (no_soal or '').strip(), (level or '').strip()
    if level and NUMBER_VALUE_RE.match(level):
        return _looks_like_level(no_soal) or not no_soal
    return bool(no_soal) and _looks_like_level(no_soal) and not level


def _one_line(text):
    return re.sub(r'\s+', '/', (text or '').strip())


def _split_merged_text(text, fields):
    """Split one merged cell into `fields` using `Jawaban:` / `Alasan:` markers."""
    text = text or ''
    matches = list(FIELD_MARKER_RE.finditer(text))
    if not matches:
        return {fields[0]: text}, False
    pieces = {}
    intro = text[:matches[0].start()].strip()
    if intro:
        pieces[fields[0]] = intro
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        name = _norm(match.group('name'))
        target = 'alasan' if name.startswith('alasan') else 'jawaban'
        if target not in fields:
            target = fields[0]
        pieces[target] = text[match.end():end].strip()
    return pieces, True


def _apply_merged_cells(grid, mapping, row, warnings, table_no, row_no):
    """Distribute a cell that spans several answer columns into those fields."""
    by_column = {idx: name for name, idx in mapping.items()}
    for cell in _cells(grid):
        fields = [
            by_column[i]
            for i in range(cell['start'], cell['start'] + cell['span'])
            if i in by_column
        ]
        fields = [f for f in fields if f in ANSWER_FIELDS]
        if len(fields) < 2:
            continue
        pieces, split = _split_merged_text(cell['text'], fields)
        for name, value in pieces.items():
            row[name] = value
        if split:
            # Split silently: the lecturer asked not to be warned about merged
            # cells, and the preview shows the result.
            continue
        label = (row.get('no_soal') or '').strip()
        where = f'Tabel {table_no} baris {row_no}' + (
            f' (No Soal {label})' if label else '')
        joined = _join_names(HUMAN_FIELDS[f] for f in fields)
        warnings.append(_issue(
            'merged_cell_unparsed',
            f'{where}: kolom {joined} digabung dalam satu sel tanpa penanda '
            f'"Jawaban:"/"Alasan:", sehingga seluruh teks masuk ke kolom '
            f'"{HUMAN_FIELDS[fields[0]]}". Pisahkan kolomnya di Word.',
            table=table_no, row=row_no, label=label))


def _row_images(grid, relmap, archive):
    """Collect a row's pictures; also return the ones the .docx is missing."""
    images, seen, missing = [], set(), []
    for cell in _cells(grid):
        for media in _cell_images(cell['tc'], relmap):
            # Dedupe per row: TOPIK 1 soal 1 embeds the SAME picture three
            # times in one cell (3 blips -> one rId); it is a single
            # Padat/Cair/Gas composite, so three copies would render thrice.
            if media in seen:
                continue
            seen.add(media)
            try:
                data = archive.read(f'word/{media}')
            except KeyError:
                missing.append(media.rsplit('/', 1)[-1])
                continue
            images.append({'name': media.rsplit('/', 1)[-1], 'data': data})
    return images, missing


WARNING_LIMIT = 40


def _cap_warnings(warnings):
    if len(warnings) <= WARNING_LIMIT:
        return warnings
    kept = warnings[:WARNING_LIMIT]
    kept.append(_issue(
        'warning_truncated',
        f'Masih ada {len(warnings) - WARNING_LIMIT} peringatan lain yang tidak '
        'ditampilkan. Periksa file Word untuk baris yang belum lengkap.'))
    return kept


def parse_instrument(path):
    """Parse a .docx into `InstrumentParse`, with locations for every problem."""
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise InstrumentParseError(
            'unreadable',
            'File .docx tidak dapat dibuka. Pastikan file berformat Word (.docx) '
            'dan tidak rusak.',
        ) from exc

    with archive as z:
        try:
            document = z.read('word/document.xml')
        except KeyError as exc:
            raise InstrumentParseError(
                'not_word',
                'File ini bukan dokumen Word (.docx). Ekspor ulang dari Word '
                'lalu unggah kembali.',
            ) from exc
        try:
            relmap = _rels(z)
        except KeyError:
            relmap = {}
        try:
            root = ET.fromstring(document)
        except ET.ParseError as exc:
            raise InstrumentParseError(
                'unreadable',
                'Isi dokumen Word tidak dapat dibaca. Simpan ulang file dari '
                'Word lalu unggah kembali.',
            ) from exc
        body = root.find(f'{W}body')
        if body is None:
            raise InstrumentParseError(
                'unreadable',
                'Dokumen Word tidak memiliki isi (body). Simpan ulang file dari '
                'Word lalu unggah kembali.',
            )

        blocks = [c for c in body if c.tag in (f'{W}p', f'{W}tbl')]
        tables = [
            (position, block, number)
            for number, (position, block) in enumerate(
                [(i, b) for i, b in enumerate(blocks) if b.tag == f'{W}tbl'], 1)
        ]
        if not tables:
            raise InstrumentParseError(
                'no_tables',
                'Dokumen tidak memiliki tabel. Tempel tabel instrumen dengan '
                'kolom No Soal, Soal, Jawaban, dan Alasan jawaban.',
            )

        instrument = None
        for position, tbl, number in tables:
            header_index, mapping = _find_header(tbl)
            if header_index is not None:
                instrument = (position, tbl, number, header_index, mapping)
                break
        if instrument is None:
            raise _no_header_error(tables)

        position, tbl, number, header_index, mapping = instrument
        trs = tbl.findall(f'{W}tr')
        topic, topic_source, explicit_topics = detect_document_topic_info(root)
        if not topic and header_index > 0:
            previous = _row_grid(trs[header_index - 1])
            if previous:
                topic = _clean_topic(_visible_math_text(previous[0]['text']))
                if topic:
                    topic_source = 'table_heading'

        distinct_topics = {t for t in explicit_topics if t}
        if len(distinct_topics) > 1:
            listed = ', '.join(f'"{t}"' for t in explicit_topics[:4])
            raise InstrumentParseError(
                'topic_ambiguous',
                f'Ditemukan lebih dari satu baris Topik: {listed}. Sisakan satu '
                'baris topik per file.',
            )
        if not topic:
            raise InstrumentParseError(
                'no_topic',
                'Topik tidak ditemukan di dalam file Word. Tambahkan baris '
                '"Topik: ..." di atas tabel instrumen.',
            )

        warnings = []
        if topic_source in ('paragraph', 'table_heading'):
            warnings.append(_issue(
                'topic_guessed',
                'Baris "Topik:" tidak ditemukan. Topik diambil dari teks di atas '
                f'tabel: "{topic}". Periksa apakah topik ini benar.',
            ))

        n_cols = len(_row_grid(trs[header_index]))

        # ---- collect data rows ----------------------------------------------
        data = [
            (number, row_no, _row_grid(tr))
            for row_no, tr in enumerate(trs[header_index + 1:], start=header_index + 2)
        ]

        # TOPIK 2's instrument can continue in the NEXT table, which repeats no
        # header. Only a DIRECTLY ADJACENT table may continue the instrument: a
        # paragraph in between means a new section ("YANG LAMA", a rubric, ...),
        # and absorbing it would silently import foreign rows as questions.
        last_position = position
        cursor = position + 1
        while cursor < len(blocks) and blocks[cursor].tag == f'{W}tbl':
            candidate = blocks[cursor]
            candidate_header, _ = _find_header(candidate)
            if candidate_header is not None:
                break                       # a new instrument starts; stop
            candidate_rows = candidate.findall(f'{W}tr')
            if not candidate_rows:
                break
            if len(_row_grid(candidate_rows[0])) != n_cols:
                break                       # different shape -> unrelated table
            candidate_number = next(
                n for p, _t, n in tables if p == cursor)
            for row_no, tr in enumerate(candidate_rows, start=1):
                data.append((candidate_number, row_no, _row_grid(tr)))
            last_position = cursor
            cursor += 1

        # ---- report everything after the instrument -------------------------
        for other_position, other, other_number in tables:
            if other_position <= last_position:
                continue
            other_header, _ = _find_header(other)
            other_rows = len(other.findall(f'{W}tr'))
            heading = _preceding_text(blocks, other_position)
            where = f'Bagian "{heading}" (tabel {other_number}, {other_rows} baris)' \
                if heading else f'Tabel {other_number} ({other_rows} baris)'
            if other_header is not None:
                raise InstrumentParseError(
                    'second_instrument',
                    'File berisi lebih dari satu instrumen. Satu file hanya boleh '
                    'memuat satu topik; pisahkan menjadi satu file per topik.',
                    [_issue(
                        'second_instrument',
                        f'{where} memiliki header instrumen sendiri dan tidak '
                        'diimpor.',
                        table=other_number)],
                )
            if other_rows >= 2 and \
                    len(_row_grid(other.findall(f'{W}tr')[0])) == n_cols:
                warnings.append(_issue(
                    'section_ignored',
                    f'{where} tidak diimpor karena berada di luar tabel instrumen '
                    'pertama. Pisahkan ke file sendiri jika soal tersebut masih '
                    'dipakai.',
                    table=other_number))

        # ---- read the rows ---------------------------------------------------
        rows = []
        swapped = {}
        placeholders = {}
        incomplete = {}

        for table_no, row_no, grid in data:
            texts = [cell['text'] for cell in grid]
            if not any(text.strip() for text in texts):
                continue
            row = {name: '' for name in FIELDS}
            for name, idx in mapping.items():
                if idx < len(texts):
                    row[name] = texts[idx]
            # a data row must carry a question number or question text
            if not (row['no_soal'].strip() or row['soal'].strip()):
                continue

            if _labels_are_swapped(row['no_soal'], row['level']):
                swapped.setdefault(table_no, []).append(
                    (row_no, row['no_soal'].strip(), row['level'].strip()))
                row['no_soal'], row['level'] = row['level'], row['no_soal']

            _apply_merged_cells(grid, mapping, row, warnings, table_no, row_no)

            label = row['no_soal'].strip()

            if not row['soal'].strip():
                placeholders.setdefault(table_no, []).append(label)
                row['images'] = []
                rows.append(row)
                continue

            missing = [
                name for name in ('jawaban', 'alasan')
                if not row[name].strip()
            ]
            if missing:
                incomplete.setdefault(table_no, []).append((label, missing))

            images, missing_images = _row_images(grid, relmap, z)
            for media_name in missing_images:
                where = f'Tabel {table_no} baris {row_no}' + (
                    f' (No Soal {label})' if label else '')
                warnings.append(_issue(
                    'image_missing',
                    f'{where}: gambar {media_name} tidak ada di dalam file dan '
                    'dilewati.',
                    table=table_no, row=row_no, label=label))
            row['images'] = images
            rows.append(row)

        for table_no, entries in swapped.items():
            first_row = min(entry[0] for entry in entries)
            last_row = max(entry[0] for entry in entries)
            sample = entries[0]
            warnings.append(_issue(
                'column_order_mismatch',
                f'Tabel {table_no} baris {first_row}-{last_row}: kolom "No Soal" '
                f'berisi level (mis. "{_one_line(sample[1])}") dan "Level Soal" '
                f'berisi nomor (mis. "{_one_line(sample[2])}"). Urutan kolom '
                'tampak tertukar; nomor soal sudah dikoreksi otomatis. Periksa '
                'urutan kolom di file Word.',
                table=table_no, row=first_row))

        for table_no, entries in incomplete.items():
            numbered = [(label, missing) for label, missing in entries if label]
            unnumbered = len(entries) - len(numbered)
            grouped = {}
            for label, missing in numbered:
                grouped.setdefault(tuple(missing), []).append(label)
            parts = []
            for missing, labels in grouped.items():
                shown = ', '.join(labels[:8]) + ('…' if len(labels) > 8 else '')
                parts.append(f'No {shown}: {" dan ".join(missing)}')
            if unnumbered:
                parts.append(f'{unnumbered} baris tanpa nomor')
            warnings.append(_issue(
                'rows_incomplete',
                f'Tabel {table_no}: {len(entries)} soal belum lengkap '
                f'({"; ".join(parts)}). Soal tetap diimpor; lengkapi sebelum '
                'menerbitkan.',
                table=table_no))

        for table_no, labels in placeholders.items():
            shown = ', '.join(labels[:8]) + ('…' if len(labels) > 8 else '')
            warnings.append(_issue(
                'placeholder_rows',
                f'Tabel {table_no}: {len(labels)} baris bernomor tanpa isi soal '
                f'(No {shown}) akan dilewati.',
                table=table_no))

    return InstrumentParse(
        topic=topic,
        rows=rows,
        warnings=_cap_warnings(warnings),
        topic_source=topic_source,
    )


def parse_instrument_docx(path):
    """Back-compat wrapper: `(declared_topic, rows)`."""
    parsed = parse_instrument(path)
    return parsed.topic, parsed.rows



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


# A 'No Soal' cell like `5.1` or `5-2` means question 5 was written across
# several table rows.
SUBOAL_LABEL_RE = re.compile(r'^\s*(\d+)\s*[.\-–—]\s*(.+?)\s*$')


def detect_sub_questions(labels):
    """Describe rows whose 'No Soal' does not map 1:1 onto a question number.

    The instruments are numbered 1..N, but nothing stops a question from spanning
    several table rows: TOPIK 1 writes question 5 as `5.1` and `5.2`, repeats the
    number in `18` and `18.2`, and may leave a row's number blank. Every row still
    becomes its own question, so the importer reports it and lets the lecturer
    decide, rather than silently importing more questions than the numbering says.

    `labels` is the raw 'No Soal' text of every row that becomes a question, in
    document order. Returns `None` when the numbering is clean.
    """
    grouped, order, blank = {}, [], 0
    for raw in labels:
        label = (raw or '').strip()
        if not label:
            blank += 1
            continue
        # Excel stores whole numbers as `5`, but a text cell can read `5.0`.
        plain = re.match(r'^(\d+)\s*[.,]\s*0+$', label)
        if plain:
            # `5.0` is question 5, never a sub-question.
            number = plain.group(1)
        else:
            match = SUBOAL_LABEL_RE.match(label)
            number = match.group(1) if match else label
        if number not in grouped:
            grouped[number] = []
            order.append(number)
        grouped[number].append(label)

    groups = [
        {'number': number, 'labels': grouped[number]}
        for number in order
        if len(grouped[number]) > 1
    ]
    if not groups and not blank:
        return None
    return {
        'groups': groups,
        'blank_number_rows': blank,
        'total_rows': len(labels),
        'total_numbers': len(order),
    }
