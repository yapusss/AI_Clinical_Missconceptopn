"""Catalogue mapping at analysis time (plan Phases 4-5).

Two jobs, both **embedding-only** (plan D7 — no new LLM completion):

* **Map** — which catalogued misconception is this? Score the analysis text
  against the topic's concepts and take the best above a threshold, with an
  explicit `no_match` abstain (D3). Stored as `concept_breakdown_json.catalog_match`.
  A candidate's score is `max(cos(text, concept), best misconception score)`,
  where the misconception score is `max(cos(text, label_vec), cos(text,
  full_vec))` — Step C's length-asymmetry fix.
* **Locate** — which concepts did the student *not* address? Shortlist the topic's
  concepts against the question's reference answer, then keep those the student's
  text does not cover. Stored as `concept_breakdown_json.missing_concepts`.

The scoring is a pure function (`score_catalog_match`) so it is testable without a
database; the DB/embedding plumbing below it is deliberately thin. Every entry
point degrades to `None`/`[]` rather than raising: a mapping failure must never
fail an analysis (same rule as the material enqueue). A `None` is always logged
with its reason (`catalog_absence_reason`) so it stays explainable.
"""

import logging

from django.conf import settings
from django.db import connection

from api.embeddings import cosine, embed_text
from api.llm import _parse_vector

logger = logging.getLogger(__name__)

DEFAULT_MATCH_THRESHOLD = 0.62
DEFAULT_COVERED_THRESHOLD = 0.50
SHORTLIST_SIZE = 8
MAX_MISSING = 3
MAX_CANDIDATES_SHOWN = 3


# ---------------------------------------------------------------------------
# Pure scoring (no DB, no network)
# ---------------------------------------------------------------------------

def _misconception_score(text_vec, misconception):
    """`max(cos(text, label_vec), cos(text, full_vec))`, or `None` if unscorable.

    Step C: a misconception carries two vectors — the extended text (label +
    description, `embedding`) and the preserved label-only vector
    (`label_embedding`, migration 0034). Taking the better of the two means the
    long analysis is no longer scored only against a short label, which depressed
    cosine for reasons unrelated to meaning. Vectors that are absent are skipped;
    `None` means the misconception has no usable embedding.
    """
    scores = []
    for key in ('embedding', 'label_embedding'):
        embedding = misconception.get(key)
        if embedding:
            scores.append(cosine(text_vec, embedding))
    return max(scores) if scores else None


def _best_misconception(text_vec, misconceptions):
    """The best-scoring misconception of the winning concept.

    Scores each misconception via `_misconception_score` (the better of its
    extended and label-only vectors). Deterministic: score desc, then `id` asc so
    a tie is stable. Misconceptions without an embedding are skipped. Returns
    `None` when none can be scored.
    """
    scored = []
    for misc in misconceptions or []:
        score = _misconception_score(text_vec, misc)
        if score is None:
            continue
        scored.append((score, str(misc['id']), misc))
    if not scored:
        return None
    scored.sort(key=lambda item: (-item[0], item[1]))
    return scored[0][2]


def score_catalog_match(text_vec, candidates, threshold=None):
    """Map one analysis vector onto the catalogue.

    `candidates` is a list of
    `{'concept_id', 'name', 'embedding', 'misconceptions': [{'id','label',
    'embedding','label_embedding'}]}`. A candidate without a concept embedding is
    skipped.

    Each candidate is scored as `max(cos(text, concept), misconception score)`,
    where the misconception score is the best of the candidate's misconceptions'
    `max(cos(text, label_vec), cos(text, full_vec))` (Step C). The **concept
    score itself is unchanged** (`cos(text, candidate embedding)`) and remains the
    floor; the extended misconception vector can only lift a candidate, never
    lower it — so no row that matched before can stop matching.

    Returns, for a match (best candidate score `>= threshold`):

        {'status': 'matched', 'concept_id', 'concept_name', 'misconception_id',
         'score', 'candidates': [{'concept_id', 'score'}, ... top 3 others]}

    and, when nothing clears the threshold (plan D3):

        {'status': 'no_match', 'score', 'candidates': [{'concept_id', 'score'}, ... top 3]}

    An empty candidate list yields `{'status': 'no_match', 'score': None,
    'candidates': []}`. Ranking is deterministic: score desc, then `concept_id`
    asc, so ties never depend on dict order.
    """
    if threshold is None:
        threshold = getattr(settings, 'CATALOG_MATCH_THRESHOLD', DEFAULT_MATCH_THRESHOLD)

    scored = []
    for candidate in candidates or []:
        embedding = candidate.get('embedding')
        if not embedding:
            continue
        concept_score = cosine(text_vec, embedding)
        best_misc = _best_misconception(
            text_vec, candidate.get('misconceptions') or [])
        misc_score = _misconception_score(text_vec, best_misc) if best_misc else None
        # The concept score is the floor; the misconception score may lift it.
        score = concept_score if misc_score is None else max(concept_score, misc_score)
        scored.append((score, str(candidate['concept_id']), candidate, best_misc))

    if not scored:
        return {'status': 'no_match', 'score': None, 'candidates': []}

    scored.sort(key=lambda item: (-item[0], item[1]))
    best_score, best_id, best_candidate, best_misconception = scored[0]

    if best_score < threshold:
        return {
            'status': 'no_match',
            'score': round(best_score, 4),
            'candidates': [
                {'concept_id': cid, 'score': round(score, 4)}
                for score, cid, _, _ in scored[:MAX_CANDIDATES_SHOWN]
            ],
        }

    return {
        'status': 'matched',
        'concept_id': best_id,
        'concept_name': best_candidate.get('name'),
        'misconception_id': str(best_misconception['id']) if best_misconception else None,
        'score': round(best_score, 4),
        'candidates': [
            {'concept_id': cid, 'score': round(score, 4)}
            for score, cid, _, _ in scored[1:1 + MAX_CANDIDATES_SHOWN]
        ],
    }


def shortlist_concepts(concepts, reference_vec, top_n=SHORTLIST_SIZE):
    """Top `top_n` concepts by cosine(concept embedding, reference vector).

    Deterministic (score desc, then `concept_id` asc); concepts without an
    embedding are skipped. Each returned concept gains `shortlist_score`.
    """
    scored = []
    for concept in concepts or []:
        embedding = concept.get('embedding')
        if not embedding:
            continue
        scored.append((cosine(reference_vec, embedding), str(concept['concept_id']), concept))
    scored.sort(key=lambda item: (-item[0], item[1]))
    shortlisted = []
    for score, _cid, concept in scored[:top_n]:
        entry = dict(concept)
        entry['shortlist_score'] = round(score, 4)
        shortlisted.append(entry)
    return shortlisted


def select_missing_concepts(shortlisted, student_vec, covered_threshold=None,
                            max_keep=MAX_MISSING):
    """Keep the shortlisted concepts the student did **not** address.

    A concept is covered when `cosine(student_vec, concept embedding) >=
    covered_threshold`; covered concepts are dropped. The survivors keep the
    shortlist's order (plan Phase 5 step 3 ranks by the step-1 score) and are
    capped at `max_keep`. Each stored entry carries the coverage `score`.
    """
    if covered_threshold is None:
        covered_threshold = getattr(
            settings, 'CONCEPT_COVERED_THRESHOLD', DEFAULT_COVERED_THRESHOLD)

    missing = []
    for concept in shortlisted or []:
        embedding = concept.get('embedding')
        if not embedding:
            continue
        score = cosine(student_vec, embedding)
        if score >= covered_threshold:
            continue
        missing.append({
            'concept_id': str(concept['concept_id']),
            'name': concept.get('name'),
            'correct_conception': concept.get('correct_conception'),
            'score': round(score, 4),
        })
        if len(missing) >= max_keep:
            break
    return missing


# ---------------------------------------------------------------------------
# DB plumbing (thin)
# ---------------------------------------------------------------------------
def _group_concepts(rows):
    """Rows `(concept_id, name, correct_conception, c_embedding, m_id, m_label,
    m_embedding, m_label_embedding)` -> the candidate list the scorer expects."""
    by_id = {}
    for (cid, name, correct_conception, c_embedding,
         m_id, m_label, m_embedding, m_label_embedding) in rows:
        key = str(cid)
        entry = by_id.get(key)
        if entry is None:
            entry = {
                'concept_id': key,
                'name': name,
                'correct_conception': correct_conception,
                'embedding': _parse_vector(c_embedding),
                'misconceptions': [],
            }
            by_id[key] = entry
        if m_id is not None:
            entry['misconceptions'].append({
                'id': str(m_id),
                'label': m_label,
                'embedding': _parse_vector(m_embedding),
                'label_embedding': _parse_vector(m_label_embedding),
            })
    return list(by_id.values())


def load_topic_concepts(topic_id):
    """Every embedded concept of a topic, with its misconceptions' embeddings."""
    if not topic_id:
        return []
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.name, c.correct_conception, c.embedding::text,
                   m.id, m.label, m.embedding::text, m.label_embedding::text
            FROM concepts c
            LEFT JOIN misconceptions m ON m.concept_id = c.id
            WHERE c.topic_id = %s AND c.embedding IS NOT NULL
            ORDER BY c.name, m.label
            """,
            [topic_id],
        )
        return _group_concepts(cur.fetchall())


def question_version_concept_ids(question_version_id):
    """Concept ids the question version is explicitly linked to (D5), or empty.

    The link table (`question_version_misconceptions`) is empty today, so this
    returns `[]` and the topic path is what runs — but when a lecturer confirms a
    match the narrowing takes effect with no code change.
    """
    if not question_version_id:
        return set()
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT m.concept_id
            FROM question_version_misconceptions qvm
            JOIN misconceptions m ON m.id = qvm.misconception_id
            WHERE qvm.question_version_id = %s AND m.concept_id IS NOT NULL
            """,
            [question_version_id],
        )
        return {str(row[0]) for row in cur.fetchall()}


def narrow_candidates(concepts, concept_ids):
    """Restrict to the explicitly linked concepts; no link means no narrowing."""
    if not concept_ids:
        return concepts
    return [c for c in concepts if c['concept_id'] in concept_ids]


def catalog_absence_reason(topic_id, concepts):
    """Why a mapping has nothing to score — a pure, DB-free classification.

    Three degrade paths collapse to a `catalog_match` of `None` today, and the
    Phase 345 task's verify step treats all of them as "nothing to map":

    * `missing_topic` — the analysis has no topic at all (`question_sets.topic_id`
      NULL), so there is no catalogue to consult;
    * `topic_not_in_catalogue` — the topic exists but carries no embedded concept,
      i.e. the question is outside the catalogue's topic scope (this is the path
      `c05d46f6-…` hit: its topic is Termodinamika, which has 0 concepts);
    * `None` — there is a candidate list, so the caller proceeds to score.

    Kept pure and separate so a null is explainable (and testable) without a
    database, rather than being an unexplained `None`.
    """
    if not topic_id:
        return 'missing_topic'
    if not concepts:
        return 'topic_not_in_catalogue'
    return None


def build_catalog_artefacts(*, analysis_text, topic_id, question_version_id=None,
                            reference_vec=None, allow_missing=True,
                            match_threshold=None, covered_threshold=None):
    """One `embed_text` call, both artefacts. Returns
    `(catalog_match, missing, text_vec)`.

    `catalog_match` is `None` when there is no topic or no embedded concept (the
    honest "nothing to map" state); `missing` is `[]` when it is not requested
    (`allow_missing=False`), when there is no reference vector, or when nothing
    qualifies. The vector is returned so the caller can see what was scored. A
    provider failure propagates as `EmbeddingError`; the caller decides how to
    degrade.

    A null is **logged with its reason** (`catalog_absence_reason`) and never
    silently swallowed: an unexplained `None` is what made the Step C.5 row look
    like a bug.
    """
    concepts = load_topic_concepts(topic_id)
    if not concepts:
        reason = catalog_absence_reason(topic_id, concepts)
        logger.info(
            'catalogue mapping has no candidates for topic=%s (%s)', topic_id, reason)
        return None, [], None

    text_vec = embed_text(analysis_text)

    concept_ids = question_version_concept_ids(question_version_id)
    candidates = narrow_candidates(concepts, concept_ids)
    if not candidates:
        # A question-version link that points outside its topic's concepts would
        # narrow everything away; log it instead of abstaining silently.
        logger.info(
            'catalogue mapping narrowed every concept away for topic=%s '
            '(question_version=%s)', topic_id, question_version_id)
    catalog_match = score_catalog_match(text_vec, candidates, match_threshold)

    missing = []
    if allow_missing and reference_vec:
        shortlisted = shortlist_concepts(concepts, reference_vec)
        missing = select_missing_concepts(
            shortlisted, text_vec, covered_threshold)

    return catalog_match, missing, text_vec
