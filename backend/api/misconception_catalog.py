"""Pure helpers for the TOPIK-1 misconception catalogue (plan Phases 1-2).

Nothing here touches the database, Django or the network:

* `parse_review_rows` turns the bank's pipe-delimited review rows
  (`D:/ClinicalAI_Misconception/Question Bank/_extracted/topik1_rows.txt`) into
  catalogue entries. The Phase 1 extractor (which deliberately lives *outside*
  the repo, at `_extracted/parse_misconceptions.py`) and
  `manage.py import_misconception_catalog` share exactly this code.
* `plan_catalog` is the idempotency key: it compares parsed entries with the
  concept names and `(concept, label)` keys already stored and reports what a run
  would create, update or leave alone. Re-running it against its own output
  creates nothing (plan D5 / task 2b).

Row shape: `ROW||| No. ||| Cakupan konsep ||| Miskonsepsi ||| Konsep yang benar`
(`⏎` is the extractor's inline newline). Sub-scope headings between the tables
(`Hakikat partikel materi`, `Ruang antar partikel (Fenomena: ...)`) become the
`group` of the rows that follow them; `Konsep yang benar` and `Konsep benar` are
both accepted, and repeated header rows are skipped.
"""

import hashlib
import re

ROW_PREFIX = 'ROW|||'
CELL_SEPARATOR = '|||'
INLINE_NEWLINE = '⏎'
# Everything after this line belongs to the instrument's question table, not to
# the misconception review tables.
TERMINATOR = 'INSTRUMEN TES MISKONSEPSI UNTUK'

_HEADER_FIRST_CELLS = {'no', 'no.'}
_JOURNAL_PREFIX = re.compile(r'^Jurnal\b[:\s”"]*', re.IGNORECASE)
# Two cells in TOPIK 1 carry a reference without the `Jurnal:` prefix (rows 38
# and 45); a parenthesised 4-digit year separates them from claim prose.
_REFERENCE_YEAR = re.compile(r'\((?:19|20)\d{2}\)')
_SPACES = re.compile(r'[ \t]+')


def _clean_multiline(text):
    """`⏎` becomes a real newline; runs of spaces collapse; ends stripped."""
    return '\n'.join(
        part.strip() for part in
        _SPACES.sub(' ', text.replace(INLINE_NEWLINE, '\n')).split('\n')
    ).strip()


def _clean_line(text):
    """Single-line text: `⏎` and any whitespace run collapse to one space."""
    return re.sub(r'\s+', ' ', text.replace(INLINE_NEWLINE, ' ')).strip()


def split_misconception_cell(cell):
    """Split a `Miskonsepsi` cell into `(claim, citations)`.

    The cell is `<claim> ⏎ Jurnal: <ref> ⏎ (<note>)`; a cell may carry a
    citation and no parenthetical, or neither. The claim keeps every segment
    before the citation (row 21 has two) so the text stays whole; the
    parenthetical/annotation that follows the citation is a comment *about* the
    reference and is dropped, because the catalogue schema stores only the claim
    and the references.
    """
    claim_parts = []
    citations = []
    seen_citation = False

    for raw_segment in cell.split(INLINE_NEWLINE):
        segment = _clean_line(raw_segment)
        if not segment:
            continue

        if _JOURNAL_PREFIX.match(segment):
            reference = _JOURNAL_PREFIX.sub('', segment).strip()
            seen_citation = True
            if reference:
                citations.append(reference)
            continue

        if not segment.startswith('(') and _REFERENCE_YEAR.search(segment):
            citations.append(segment)
            seen_citation = True
            continue

        if seen_citation:
            continue  # the note annotating the citation

        claim_parts.append(segment)

    return '\n'.join(claim_parts).strip(), citations


def parse_review_rows(text, *, inherit_concept=True):
    """Parse the extractor's review rows into catalogue entries.

    Returns a list of
    `{'group', 'no', 'concept', 'misconception', 'correct_conception', 'citations'}`.
    Continuation rows (empty `No.`, e.g. the ice/H2O row, and the vertically
    merged Hukum Avogadro row) are real entries: `no` stays empty and, when
    `inherit_concept` is set, `concept` is inherited from the row above, which is
    exactly the meaning of the merged cell in the source.
    """
    entries = []
    group = ''
    last_concept = ''

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith('<<<'):
            continue
        if line.upper().startswith(TERMINATOR):
            break

        if line.startswith(ROW_PREFIX):
            cells = [cell.strip() for cell in line.split(CELL_SEPARATOR)[1:]]
            # Review rows have exactly four cells; question-table rows have seven
            # or eight and are ignored even if the terminator is missing.
            if len(cells) != 4 or cells[0].lower() in _HEADER_FIRST_CELLS:
                continue

            no, concept, misconception_cell, correct_conception = cells
            concept = _clean_multiline(concept)
            if concept:
                last_concept = concept
            elif inherit_concept:
                concept = last_concept

            claim, citations = split_misconception_cell(misconception_cell)
            entries.append({
                'group': group,
                'no': no,
                'concept': concept,
                'misconception': claim,
                'correct_conception': _clean_multiline(correct_conception),
                'citations': citations,
            })
            continue

        group = line

    return entries


def build_description(correct_conception, citations):
    """The `misconceptions.description` text.

    The correct conception stays the first paragraph so existing readers are
    unaffected; the references follow as a trailing `Sumber:` line, because the
    table has no citations column (task 2b).
    """
    description = correct_conception.strip()
    if citations:
        description = f'{description}\n\nSumber: {"; ".join(citations)}'
    return description


def catalog_keys(entries):
    """Idempotency keys in input order: `[(concept, label), ...]`, deduplicated."""
    keys = []
    seen = set()
    for entry in entries:
        key = (entry['concept'], entry['misconception'])
        if key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def plan_catalog(entries, existing_concepts, existing_misconceptions):
    """Diff parsed entries against the stored state; pure, no DB.

    `existing_concepts` maps `concept name -> correct_conception`;
    `existing_misconceptions` maps `(concept name, label) -> description`.

    Returns `{'counts': {...}, 'rows': [...]}`. `counts` has exactly the four
    buckets the command prints: `concepts_created`, `misconceptions_created`,
    `updated`, `unchanged`. Names repeat in the bank (three `Ukuran partikel`
    rows, two `Hukum Boyle` rows, two `Persamaan gas ideal` rows), so a concept
    is created once and the *first* occurrence supplies
    `concepts.correct_conception`; every row still contributes its own
    misconception, whose `description` carries that row's correct conception, so
    nothing is lost where the mapping reads it.
    """
    counts = {
        'concepts_created': 0,
        'misconceptions_created': 0,
        'updated': 0,
        'unchanged': 0,
    }
    rows = []
    planned_concepts = {}

    for entry in entries:
        name = entry['concept']
        label = entry['misconception']
        description = build_description(
            entry['correct_conception'], entry.get('citations') or [],
        )

        if name not in planned_concepts:
            planned_concepts[name] = entry['correct_conception']
            if name not in existing_concepts:
                concept_action = 'create'
                counts['concepts_created'] += 1
            elif existing_concepts[name] != entry['correct_conception']:
                concept_action = 'update'
                counts['updated'] += 1
            else:
                concept_action = 'exists'
        else:
            concept_action = 'exists'

        current = existing_misconceptions.get((name, label))
        if current is None:
            action = 'create'
            counts['misconceptions_created'] += 1
        elif current != description:
            action = 'update'
            counts['updated'] += 1
        else:
            action = 'unchanged'
            counts['unchanged'] += 1

        rows.append({
            'group': entry.get('group', ''),
            'no': entry.get('no', ''),
            'concept': name,
            'label': label,
            'correct_conception': entry['correct_conception'],
            'description': description,
            'citations': list(entry.get('citations') or []),
            'concept_action': concept_action,
            'action': action,
        })

    return {'counts': counts, 'rows': rows}


# ---------------------------------------------------------------------------
# Embedding text + change detector (plan Phase 3)
#
# One canonical builder per object, used by BOTH the embedder and the hash, so
# the stored `content_hash` is always the sha256 of exactly the embedded text: a
# text change changes the hash, and a hash change triggers a re-embed.
# ---------------------------------------------------------------------------

def concept_embedding_text(name, correct_conception):
    """`name + "\\n" + correct_conception` — the concept's embedded text."""
    return f'{name}\n{correct_conception}'


def misconception_embedding_text(label):
    """The misconception's embedded text: its `label`, nothing else."""
    return label or ''


def catalog_content_hash(text):
    """sha256 hex digest — the 64-char lowercase key stored in `CHAR(64)`.

    Same pattern as `reference_answers.answer_hash` (C2).
    """
    return hashlib.sha256((text or '').encode('utf-8')).hexdigest()
