"""Hybrid retrieval against the pd_cctv schema.

Two operations:
  search(q, k)     -- BGE-small-encode the query, return top-k narrations by
                      cosine distance plus the joined clip metadata.
  expand(clip_id)  -- pull entities and events for the given clip (KG-lite walk).
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

import psycopg
from sentence_transformers import SentenceTransformer

log = logging.getLogger(__name__)

_DSN = (
    f"host={os.environ.get('PGHOST', '')} "
    f"dbname={os.environ.get('PGDATABASE', 'rhoai_demo')} "
    f"user={os.environ.get('PGUSER', 'rhoai_admin')} "
    f"password={os.environ.get('PGPASSWORD', '')}"
)


@lru_cache(maxsize=1)
def _embedder() -> SentenceTransformer:
    return SentenceTransformer("BAAI/bge-small-en-v1.5")


def healthcheck() -> None:
    with psycopg.connect(_DSN, connect_timeout=3) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pd_cctv.clips LIMIT 1")


def search(q: str, k: int = 8) -> list[dict[str, Any]]:
    emb = _embedder().encode(q, normalize_embeddings=True).tolist()
    with psycopg.connect(_DSN, connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT n.narration_id::text, n.clip_id::text, n.prose,
                       (1 - (n.embedding <=> %s::vector))::float AS score,
                       c.s3_uri, c.uploaded_at
                FROM   pd_cctv.narrations n
                JOIN   pd_cctv.clips c ON c.clip_id = n.clip_id
                ORDER  BY n.embedding <=> %s::vector
                LIMIT  %s
                """,
                (emb, emb, k),
            )
            rows = cur.fetchall()
    return [
        {
            "narration_id": r[0],
            "clip_id":      r[1],
            "prose":        r[2],
            "score":        r[3],
            "s3_uri":       r[4],
            "uploaded_at":  r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]


def expand(clip_id: str) -> dict[str, Any]:
    with psycopg.connect(_DSN, connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT entity_id::text, kind, label "
                "FROM pd_cctv.entities WHERE first_seen_clip = %s",
                (clip_id,),
            )
            entities = [{"entity_id": e[0], "kind": e[1], "label": e[2]}
                        for e in cur.fetchall()]
            cur.execute(
                "SELECT event_id::text, action, "
                "       EXTRACT(EPOCH FROM t_start)::float AS t_start, "
                "       EXTRACT(EPOCH FROM t_end)::float AS t_end, confidence "
                "FROM pd_cctv.events WHERE clip_id = %s",
                (clip_id,),
            )
            events = [{"event_id": e[0], "action": e[1], "t_start": e[2],
                       "t_end": e[3], "confidence": e[4]}
                      for e in cur.fetchall()]
    return {"clip_id": clip_id, "entities": entities, "events": events}
