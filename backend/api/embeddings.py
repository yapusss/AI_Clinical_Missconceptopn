"""Embeddings client + vector helpers (Phase R2).

Embeddings come from OpenRouter (`settings.EMBEDDINGS_BASE_URL`) using
`settings.EMBEDDINGS_MODEL` at `settings.EMBEDDINGS_DIMENSIONS` dimensions.
The dimension count MUST match the `knowledge_chunks.embedding vector(1536)`
column — every returned vector is validated against it.

`grounded_similarity()` deliberately does NOT live here: it needs the
retrieved-chunk dicts and the citation payload shape, so it belongs in
`llm.py` (a later phase).
"""

import logging
import math
import time
from collections.abc import Sequence

from django.conf import settings
from openai import OpenAI

logger = logging.getLogger(__name__)

# Retries are per batch: a transient provider error must not kill a whole
# multi-hundred-chunk ingest.
EMBEDDING_MAX_RETRIES = 3


class EmbeddingError(Exception):
    """Raised when embeddings cannot be produced after retries."""


def get_embeddings_client() -> OpenAI:
    """OpenAI-compatible client pointed at the embeddings provider.

    Timeout reuses `LLM_TIMEOUT` (default 120s), matching `get_llm_client()`.
    """
    return OpenAI(
        base_url=settings.EMBEDDINGS_BASE_URL,
        api_key=settings.EMBEDDINGS_API_KEY,
        timeout=getattr(settings, 'LLM_TIMEOUT', 120.0),
    )


def _embed_batch(client: OpenAI, batch: list[str]) -> list[list[float]]:
    """Embed one batch, retrying with backoff. Raises EmbeddingError."""
    last_error = None
    for attempt in range(EMBEDDING_MAX_RETRIES + 1):
        try:
            response = client.embeddings.create(
                model=settings.EMBEDDINGS_MODEL,
                input=batch,
                dimensions=settings.EMBEDDINGS_DIMENSIONS,
            )
            # The API does not guarantee ordering; index preserves input order.
            ordered = sorted(response.data, key=lambda d: d.index)
            return [list(item.embedding) for item in ordered]
        except Exception as e:  # noqa: BLE001 — provider errors are opaque
            last_error = e
            if attempt < EMBEDDING_MAX_RETRIES:
                backoff = 1.5 * (attempt + 1)
                logger.warning(
                    'Embedding batch of %d failed (attempt %d/%d): %s — retrying in %.1fs',
                    len(batch), attempt + 1, EMBEDDING_MAX_RETRIES + 1, e, backoff,
                )
                time.sleep(backoff)
    raise EmbeddingError(
        f'Embedding failed after {EMBEDDING_MAX_RETRIES + 1} attempts: {last_error}'
    )


def embed_texts(texts: list[str], batch_size: int = 64) -> list[list[float]]:
    """Batched embeddings, order-preserving.

    Retries each batch with backoff and raises `EmbeddingError` on final
    failure. Validates every vector's length against
    `settings.EMBEDDINGS_DIMENSIONS` so a mis-sized vector can never reach the
    `vector(1536)` column.
    """
    if not texts:
        return []
    if batch_size < 1:
        raise ValueError('batch_size must be >= 1')

    dims = settings.EMBEDDINGS_DIMENSIONS
    client = get_embeddings_client()
    vectors: list[list[float]] = []
    total_batches = math.ceil(len(texts) / batch_size)

    for batch_no, start in enumerate(range(0, len(texts), batch_size), start=1):
        batch = texts[start:start + batch_size]
        batch_vectors = _embed_batch(client, batch)
        for vec in batch_vectors:
            if len(vec) != dims:
                raise EmbeddingError(
                    f'Embedding dimension mismatch: expected {dims}, got {len(vec)} '
                    f'(batch {batch_no}/{total_batches})'
                )
        vectors.extend(batch_vectors)
        logger.debug('Embedded batch %d/%d (%d texts)', batch_no, total_batches, len(batch))

    return vectors


def embed_text(text: str) -> list[float]:
    """Embed a single string."""
    return embed_texts([text])[0]


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity, clamped to [-1, 1].

    Returns 0.0 when either vector has zero norm (never ZeroDivisionError).
    """
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b):
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a <= 0.0 or norm_b <= 0.0:
        return 0.0
    value = dot / (math.sqrt(norm_a) * math.sqrt(norm_b))
    return max(-1.0, min(1.0, value))


def vector_literal(vec: Sequence[float]) -> str:
    """`'[0.1,0.2,...]'` — the text form to pass with a `%s::vector` cast."""
    return '[' + ','.join(repr(float(x)) for x in vec) + ']'


def _answer_tier_similarity(text, reference_vec) -> float | None:
    """One tier's cosine. `None` when either side is unavailable.

    The reference vector is always supplied by the caller from the cache
    (`reference_answers.embedding`, populated by C2) — it is NEVER embedded
    here, so a missing cached vector yields `None` rather than a hidden
    per-analysis provider call (D2).
    """
    if not (text or '').strip():
        return None
    if not reference_vec:
        return None
    student_vec = embed_text(text)
    return round(cosine(student_vec, reference_vec), 4)


def answer_similarity(t1_text, t3_text, ref_t1_vec, ref_t3_vec) -> tuple[float | None, float | None]:
    """Cosine of each student text against its cached reference vector.

    Embeds only the student's two texts (exactly two provider calls when both
    are present and both references are cached). Returns `(sim1, sim3)`, each
    rounded to 4 decimals, or `None` for a side that cannot be measured: empty
    student text, or a missing cached reference vector. A provider failure
    propagates as `EmbeddingError`; the caller decides how to degrade.
    """
    return (
        _answer_tier_similarity(t1_text, ref_t1_vec),
        _answer_tier_similarity(t3_text, ref_t3_vec),
    )
