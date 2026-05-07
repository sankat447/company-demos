"""Shared helpers for the three persona graphs.

Mode-aware: reads the `pd-llm-mode` ConfigMap (via app.tools.mode) and
dispatches the chat call accordingly:
  mock   -> app.tools.llm_mock returns canned-but-grounded responses
  local  -> app.tools.portkey_llm hits Portkey with model=PORTKEY_MODEL_LOCAL
  claude -> app.tools.portkey_llm hits Portkey with model=PORTKEY_MODEL_CLAUDE
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from app.schemas import ChatRequest, Claim, PersonaResponse, Provenance
from app.tools import anthropic_llm, clip_context, llm_mock, mode, pgvector_query, portkey_llm

log = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

# Per-mode model identifiers (Portkey routes by model name).
_MODELS = {
    "local":  os.environ.get("PORTKEY_MODEL_LOCAL",  "llama-3-1-8b"),
    "claude": os.environ.get("PORTKEY_MODEL_CLAUDE", "claude-sonnet-4"),
}


def load_prompt(persona: str) -> str:
    return (_PROMPTS_DIR / f"{persona}.md").read_text(encoding="utf-8")


def hybrid_retrieve(req: ChatRequest) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    # When a clip is pinned, skip vector retrieval entirely. The clip's own
    # context is enough; we save the BGE-small embed call and avoid loading
    # the model on the hot path. Vector search remains for "find a clip
    # like this query" usage with no clip_id.
    hits: list[dict[str, Any]] = []
    expansion: dict[str, Any] | None = None
    if req.clip_id:
        expansion = pgvector_query.expand(req.clip_id)
    else:
        hits = pgvector_query.search(req.q, k=req.k)
        if hits:
            expansion = pgvector_query.expand(hits[0]["clip_id"])
    return hits, expansion


def render_context(
    hits: list[dict[str, Any]],
    expansion: dict[str, Any] | None,
    clip_ctx: dict[str, Any] | None = None,
) -> str:
    blocks = []
    for i, h in enumerate(hits, 1):
        blocks.append(
            f"[narration #{i}, clip={h['clip_id'][:8]}, score={h['score']:.3f}]\n{h['prose']}"
        )
    if clip_ctx:
        # The pinned-clip narration is the primary evidence — without
        # this the persona reasons only over plates + face tracks and
        # produces a generic "people arriving in waves" answer instead
        # of the rich Vehicle / Timeline / Suspects narrative the
        # vlm-caption stage actually wrote into Aurora.
        clip_prose = (clip_ctx.get("prose") or "").strip()
        if clip_prose:
            blocks.append(
                f"[clip narration] (clip={clip_ctx.get('clip_id_short','?')})\n"
                + clip_prose
            )
        # Surface the most actionable per-clip evidence the perception
        # pipeline produced — license-plate readings and face detections.
        plates = clip_ctx.get("plates") or []
        faces = clip_ctx.get("faces") or {}
        if plates:
            lines = [
                f"  - {p['text']} ({p['sightings']}× between "
                f"{p.get('first_ts', 0):.1f}s and {p.get('last_ts', 0):.1f}s, "
                f"conf {p.get('confidence', 0):.2f})"
                for p in plates
            ]
            blocks.append("[license-plate OCR readings]\n" + "\n".join(lines))
        if faces.get("count"):
            # Raw detection count is misleading (one face -> many boxes
            # across sampled frames). Surface the bbox-track grouping
            # so the model says "5 unique subjects" not "300 detections".
            tracks = faces.get("tracks") or []
            n_subjects = faces.get("unique_subjects", len(tracks))
            head = (
                f"[face detections] {n_subjects} unique subject"
                f"{'s' if n_subjects != 1 else ''} "
                f"({faces['count']} raw detections, "
                f"first_seen={faces.get('first_seen_sec')}s, "
                f"last_seen={faces.get('last_seen_sec')}s)"
            )
            if tracks:
                rows = [
                    f"  - subject {t['track_id']}: "
                    f"{t['sightings']} sighting{'s' if t['sightings'] != 1 else ''}, "
                    f"first {t['first_ts']:.1f}s, last {t['last_ts']:.1f}s"
                    for t in tracks
                ]
                head += "\n" + "\n".join(rows)
            blocks.append(head)
    if expansion:
        blocks.append(
            "[knowledge-graph expansion]\n"
            + json.dumps(expansion, indent=2, default=str)[:2000]
        )
    return "\n\n".join(blocks) if blocks else "(no narrations indexed yet)"


def _real_llm_call(persona: str, req: ChatRequest, model: str, *,
                   provider: str = "portkey") -> PersonaResponse:
    """Hit a real LLM (Llama via Portkey, or Anthropic Claude direct) with the
    persona system prompt. provider routes the call:
      portkey   -> http://portkey.ai-demo.svc:8787 (used for local-Llama)
      anthropic -> https://api.anthropic.com/v1/messages (used for claude mode)
    """
    hits, expansion = hybrid_retrieve(req)
    # When the operator pinned a specific clip, fetch the full context so
    # the prompt sees license plates / face counts alongside the narration.
    clip_ctx = clip_context.load(req.clip_id) if req.clip_id else None
    system = load_prompt(persona)
    user = (
        f"OPERATOR QUESTION:\n{req.q}\n\n"
        f"CONTEXT:\n{render_context(hits, expansion, clip_ctx)}\n\n"
        "Respond as JSON: {prose, claims:[{text,confidence,frame_refs}]}"
    )
    if provider == "anthropic":
        parsed = anthropic_llm.chat_json(system, user, temperature=0.2, model=model)
    else:
        parsed = portkey_llm.chat_json(system, user, temperature=0.2, model=model)
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


def _mock_call(persona: str, req: ChatRequest) -> PersonaResponse:
    """Mock LLM grounded in real Aurora context for the given clip_id."""
    ctx: dict[str, Any] = {}
    if req.clip_id:
        loaded = clip_context.load(req.clip_id)
        if loaded:
            ctx = loaded
    if not ctx:
        # No specific clip — fall back to top retrieval hit.
        hits, _ = hybrid_retrieve(req)
        if hits:
            top = hits[0]
            loaded = clip_context.load(top["clip_id"])
            if loaded:
                ctx = loaded
    return llm_mock.respond(persona, req, ctx)


def call_llm_as_persona(persona: str, req: ChatRequest) -> PersonaResponse:
    """Mode-aware persona dispatch."""
    m = mode.current()
    log.info("persona=%s mode=%s clip_id=%s", persona, m, req.clip_id)
    if m == "mock":
        return _mock_call(persona, req)
    model = _MODELS.get(m, _MODELS["local"])
    # claude mode → direct Anthropic Messages API; local mode → Portkey (Llama)
    provider = "anthropic" if m == "claude" else "portkey"
    try:
        return _real_llm_call(persona, req, model, provider=provider)
    except Exception as e:
        log.warning("real LLM call failed (mode=%s, model=%s, provider=%s): %s — falling back to mock",
                    m, model, provider, e)
        return _mock_call(persona, req)
