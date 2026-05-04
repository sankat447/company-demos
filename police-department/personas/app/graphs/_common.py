"""Shared helpers for the three persona graphs."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from app.schemas import ChatRequest, Claim, PersonaResponse, Provenance
from app.tools import pgvector_query, portkey_llm

log = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"


def load_prompt(persona: str) -> str:
    return (_PROMPTS_DIR / f"{persona}.md").read_text(encoding="utf-8")


def hybrid_retrieve(req: ChatRequest) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    hits = pgvector_query.search(req.q, k=req.k)
    expansion: dict[str, Any] | None = None
    if req.clip_id:
        expansion = pgvector_query.expand(req.clip_id)
    elif hits:
        # Default: walk the top hit's clip
        expansion = pgvector_query.expand(hits[0]["clip_id"])
    return hits, expansion


def render_context(hits: list[dict[str, Any]], expansion: dict[str, Any] | None) -> str:
    blocks = []
    for i, h in enumerate(hits, 1):
        blocks.append(
            f"[narration #{i}, clip={h['clip_id'][:8]}, score={h['score']:.3f}]\n{h['prose']}"
        )
    if expansion:
        blocks.append(
            "[knowledge-graph expansion]\n"
            + json.dumps(expansion, indent=2, default=str)[:2000]
        )
    return "\n\n".join(blocks) if blocks else "(no narrations indexed yet)"


def call_llm_as_persona(persona: str, req: ChatRequest) -> PersonaResponse:
    """Single-step graph: retrieve → format context → call LLM → parse."""
    hits, expansion = hybrid_retrieve(req)
    system = load_prompt(persona)
    user = (
        f"OPERATOR QUESTION:\n{req.q}\n\n"
        f"CONTEXT:\n{render_context(hits, expansion)}\n\n"
        "Respond as JSON: {prose, claims:[{text,confidence,frame_refs}]}"
    )
    parsed = portkey_llm.chat_json(system, user, temperature=0.2)
    claims = [Claim(**c) for c in parsed.get("claims", []) if isinstance(c, dict)]

    provenance = Provenance(
        clip_ids=list({h["clip_id"] for h in hits}),
        narration_ids=[h["narration_id"] for h in hits],
    )
    evidence_clip = (req.clip_id or
                     (hits[0]["clip_id"] if hits else None))

    return PersonaResponse(
        persona=persona,
        prose=parsed.get("prose", "").strip()
              or "(model returned no prose; see raw)",
        claims=claims,
        provenance=provenance,
        evidence_clip_id=evidence_clip,
        raw=parsed,
    )
