"""Smart mock LLM for UX testing.

When `pd-llm-mode` ConfigMap is set to `mock` (the default during UI
development), persona /chat responses come from this module instead of
calling Portkey. The mock is *grounded in real Aurora data*: it reads
the actual narration / entities / events / transcript rows for the
clip and composes role-distinct prose around them. That makes the UI
testable without GPU spend AND surfaces real persona-prompt behaviour
once the Aurora pipeline has populated rows.

The three personas produce visibly different outputs:
  Detective     -- long investigative narrative; observed vs inferred
  Patrol        -- short BOLO-style bullets; field-debrief tone
  Evidence Clerk -- chain-of-custody manifest; one row per clip
"""
from __future__ import annotations

import json
from typing import Any

from app.schemas import ChatRequest, Claim, PersonaResponse, Provenance


def _format_entities(entities: list[dict[str, Any]]) -> str:
    if not entities:
        return "no entities catalogued"
    by_kind: dict[str, list[str]] = {}
    for e in entities:
        by_kind.setdefault(e.get("kind", "unknown"), []).append(e.get("label", "?"))
    return ", ".join(f"{k}: {'; '.join(v)}" for k, v in by_kind.items())


def _format_events(events: list[dict[str, Any]]) -> str:
    if not events:
        return "no temporal events extracted"
    lines = []
    for e in events[:6]:
        t0 = e.get("t_start_sec", e.get("t_start", "?"))
        t1 = e.get("t_end_sec", e.get("t_end", "?"))
        lines.append(f"  - {t0}s–{t1}s: {e.get('action', '?')}")
    return "\n".join(lines)


def _detective(req: ChatRequest, ctx: dict[str, Any]) -> dict[str, Any]:
    clip = ctx.get("clip_id_short", "—")
    prose = ctx.get("prose") or "no narration on file"
    entities = ctx.get("entities", [])
    events = ctx.get("events", [])
    transcript_segs = ctx.get("transcript_segments", [])

    body = (
        f"### Investigative read on clip {clip}\n\n"
        f"**Operator question:** {req.q}\n\n"
        f"**Observed (from VLM caption):** {prose}\n\n"
        f"**Catalogued objects:** {_format_entities(entities)}\n\n"
        f"**Temporal events:**\n{_format_events(events)}\n\n"
    )
    if transcript_segs:
        snippet = " ".join(s.get("text", "").strip() for s in transcript_segs[:3])
        body += f"**Audio (transcribed):** \"{snippet[:240]}…\"\n\n"
    body += (
        "**Inference:** Based on the catalogued entities and the temporal "
        "ordering of events, this clip is *consistent with* a routine "
        "street-level encounter. No facial-recognition or licence-plate "
        "extraction has been performed (out of scope for this pipeline). "
        "Recommend cross-referencing the time window against the dispatch "
        "log and pulling adjacent CCTV nodes (±60s, ±200m).\n\n"
        "*(Mock response — Detective persona, generated from real Aurora rows. "
        "Replace with Llama-70B by switching mode to `local` or `claude`.)*"
    )

    claims: list[dict[str, Any]] = []
    for ev in events[:3]:
        claims.append({
            "text": f"{ev.get('action', 'event')} observed between "
                    f"{ev.get('t_start_sec', '?')}–{ev.get('t_end_sec', '?')}s",
            "confidence": float(ev.get("confidence", 0.7)),
            "frame_refs": [f"clip:{clip}"],
        })
    return {"prose": body, "claims": claims}


def _patrol(req: ChatRequest, ctx: dict[str, Any]) -> dict[str, Any]:
    clip = ctx.get("clip_id_short", "—")
    entities = ctx.get("entities", [])
    events = ctx.get("events", [])

    bullets: list[str] = []
    # Vehicle BOLOs from entities
    for e in entities:
        if e.get("kind") == "vehicle":
            bullets.append(
                f"BOLO vehicle: {e.get('label', '(unspecified)')} — last seen "
                f"in clip {clip}. No plate captured."
            )
    # Person BOLOs
    for e in entities:
        if e.get("kind") == "person":
            bullets.append(
                f"BOLO person: {e.get('label', '(unspecified)')} — direction-of-"
                f"travel unknown; no clothing detail captured."
            )
    # Action follow-ups
    for ev in events[:3]:
        bullets.append(
            f"Action @ {ev.get('t_start_sec', '?')}s: {ev.get('action', '?')} "
            f"(confidence {float(ev.get('confidence', 0)):.2f})"
        )

    if not bullets:
        bullets = ["No actionable items in this clip — recommend pulling adjacent feeds."]

    prose = (
        f"**Patrol brief — clip {clip}**\n\n"
        + "\n".join(f"- {b}" for b in bullets[:6])
        + "\n\n"
        f"Operator question was: \"{req.q}\". "
        "Treat the above as field-only; full case work for Detective.\n\n"
        "*(Mock response — Patrol persona)*"
    )

    claims = [
        {"text": b, "confidence": 0.6, "frame_refs": [f"clip:{clip}"]}
        for b in bullets[:6]
    ]
    return {"prose": prose, "claims": claims}


def _evidence_clerk(req: ChatRequest, ctx: dict[str, Any]) -> dict[str, Any]:
    clip = ctx.get("clip_id_short", "—")
    full_clip_id = ctx.get("clip_id_full", clip)
    s3_uri = ctx.get("s3_uri", "(unknown)")
    sha256 = ctx.get("sha256", "(unhashed)")
    uploaded_by = ctx.get("uploaded_by", "(unknown)")
    uploaded_at = ctx.get("uploaded_at", "(unknown)")
    custody_count = ctx.get("custody_log_count", 0)

    prose = (
        f"**Evidence packet — clip {clip}**\n\n"
        f"This packet certifies that the named clip has been ingested into "
        f"the police-department CCTV pipeline and is available for "
        f"subpoena. The chain-of-custody log records {custody_count} "
        f"events for this clip from ingest through narration write-back.\n\n"
        f"Operator question: \"{req.q}\"\n\n"
        "*(Mock response — Evidence Clerk persona)*"
    )

    claims = [{
        "text": f"{full_clip_id}: {s3_uri} sha256={sha256} "
                f"uploaded_by={uploaded_by} @{uploaded_at}",
        "confidence": 1.0,
        "frame_refs": [f"clip:{clip}"],
    }]
    return {"prose": prose, "claims": claims}


_MOCKS = {
    "detective": _detective,
    "patrol": _patrol,
    "evidence_clerk": _evidence_clerk,
}


def respond(persona: str, req: ChatRequest, ctx: dict[str, Any]) -> PersonaResponse:
    """Return a persona-distinct mock response, grounded in real Aurora context."""
    handler = _MOCKS.get(persona)
    if handler is None:
        raise ValueError(f"no mock for persona {persona!r}")
    parsed = handler(req, ctx)
    claims = [Claim(**c) for c in parsed.get("claims", [])]
    return PersonaResponse(
        persona=persona,
        prose=parsed["prose"],
        claims=claims,
        provenance=Provenance(clip_ids=[ctx.get("clip_id_full")] if ctx.get("clip_id_full") else []),
        evidence_clip_id=ctx.get("clip_id_full"),
        raw=parsed,
    )
