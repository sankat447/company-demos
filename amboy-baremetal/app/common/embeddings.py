"""Local CPU embeddings (MiniLM, baked into the image).

De-identified text is vectorized HERE, in-cluster — never sent to an external
embedding API — so even token-only text never crosses the egress boundary.
"""
from functools import lru_cache

from . import config


@lru_cache(maxsize=1)
def _model():
    from sentence_transformers import SentenceTransformer  # lazy: heavy import
    return SentenceTransformer(config.EMBED_MODEL)


def embed(text: str):
    """Return a 384-dim unit-normalized embedding as a plain list[float]."""
    return _model().encode(text or "", normalize_embeddings=True).tolist()


def embed_batch(texts):
    """Embed many chunks in ONE encode call (far faster than per-chunk on CPU)."""
    if not texts:
        return []
    return _model().encode(list(texts), normalize_embeddings=True, batch_size=32).tolist()


def to_pgvector(vec) -> str:
    """Format a vector for a pgvector column literal: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"
