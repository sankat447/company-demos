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


def _format_plates(plates: list[dict[str, Any]]) -> str:
    if not plates:
        return "no license-plate readings on file"
    return "\n".join(
        f"  - {p['text']} ({p.get('sightings', 1)}× between "
        f"{p.get('first_ts', 0):.1f}s–{p.get('last_ts', 0):.1f}s, "
        f"OCR conf {p.get('confidence', 0):.2f})"
        for p in plates[:6]
    )


def _format_faces(faces: dict[str, Any]) -> str:
    n = (faces or {}).get("count", 0)
    if not n:
        return "no faces detected"
    return (f"{n} face detection{'s' if n != 1 else ''} between "
            f"{(faces.get('first_seen_sec') or 0):.1f}s and "
            f"{(faces.get('last_seen_sec') or 0):.1f}s")


def _detective(req: ChatRequest, ctx: dict[str, Any]) -> dict[str, Any]:
    clip = ctx.get("clip_id_short", "—")
    prose = ctx.get("prose") or "no narration on file"
    entities = ctx.get("entities", [])
    events = ctx.get("events", [])
    plates = ctx.get("plates", [])
    faces = ctx.get("faces", {}) or {}
    transcript_segs = ctx.get("transcript_segments", [])

    body = (
        f"### Investigative read on clip {clip}\n\n"
        f"**Operator question:** {req.q}\n\n"
        f"**Observed (from VLM caption):** {prose}\n\n"
        f"**Catalogued objects:** {_format_entities(entities)}\n\n"
        f"**License-plate readings:**\n{_format_plates(plates)}\n\n"
        f"**Faces on camera:** {_format_faces(faces)}\n\n"
        f"**Temporal events:**\n{_format_events(events)}\n\n"
    )
    if transcript_segs:
        snippet = " ".join(s.get("text", "").strip() for s in transcript_segs[:3])
        body += f"**Audio (transcribed):** \"{snippet[:240]}…\"\n\n"

    plate_phrase = (
        f"plate {plates[0]['text']} (OCR conf {plates[0].get('confidence', 0):.2f})"
        if plates else "no plates extractable from frame quality"
    )
    body += (
        f"**Inference:** Catalogued entities, OCR pass and face detector are "
        f"*consistent with* a routine street-level encounter; "
        f"{plate_phrase}. "
        "Recommend cross-referencing the plate against DVLA/state registry "
        "and pulling adjacent CCTV nodes (±60s, ±200m) for facial-recognition "
        "follow-up on the captured face crops.\n\n"
        "*(Mock response — Detective persona, generated from real Aurora rows. "
        "Replace with Llama-70B by switching mode to `local` or `claude`.)*"
    )

    claims: list[dict[str, Any]] = []
    for p in plates[:2]:
        claims.append({
            "text": f"License plate {p['text']} observed {p.get('sightings', 1)}× "
                    f"in clip {clip}",
            "confidence": float(p.get("confidence", 0.7)),
            "frame_refs": [f"clip:{clip}:{p.get('first_ts', 0):.1f}s"],
        })
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
    plates = ctx.get("plates", [])
    faces = ctx.get("faces", {}) or {}

    bullets: list[str] = []
    # Plate BOLOs first — these are the most operationally actionable.
    for p in plates[:3]:
        bullets.append(
            f"BOLO plate {p['text']} — sighted {p.get('sightings', 1)}× in clip "
            f"{clip} between {p.get('first_ts', 0):.1f}s and "
            f"{p.get('last_ts', 0):.1f}s (OCR conf {p.get('confidence', 0):.2f})"
        )
    # Vehicle BOLOs from entities (if no plate, link to vehicle entry)
    for e in entities:
        if e.get("kind") == "vehicle":
            label = e.get("label", "(unspecified)")
            plate_hint = f", plate {plates[0]['text']}" if plates else ", no plate captured"
            bullets.append(f"BOLO vehicle: {label}{plate_hint} — last seen in clip {clip}")
    # Person BOLOs
    for e in entities:
        if e.get("kind") == "person":
            bullets.append(
                f"BOLO person: {e.get('label', '(unspecified)')} — direction-of-"
                f"travel unknown; no clothing detail captured."
            )
    if faces.get("count"):
        bullets.append(
            f"{faces['count']} face crop{'s' if faces['count'] != 1 else ''} "
            f"captured ({(faces.get('first_seen_sec') or 0):.1f}s–"
            f"{(faces.get('last_seen_sec') or 0):.1f}s); recommend FR cross-check"
        )
    # Action follow-ups
    for ev in events[:2]:
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
    plates = ctx.get("plates", [])
    faces = ctx.get("faces", {}) or {}

    plate_lines = "\n".join(
        f"  - `{p['text']}` — {p.get('sightings', 1)} sighting"
        f"{'s' if p.get('sightings', 1) != 1 else ''}, "
        f"conf max {p.get('confidence', 0):.2f}"
        for p in plates[:8]
    ) or "  (none on file)"

    prose = (
        f"**Evidence packet — clip {clip}**\n\n"
        f"This packet certifies that the named clip has been ingested into "
        f"the police-department CCTV pipeline and is available for "
        f"subpoena. The chain-of-custody log records {custody_count} "
        f"events for this clip from ingest through narration write-back.\n\n"
        f"**Plate readings on file:**\n{plate_lines}\n\n"
        f"**Face detections on file:** {faces.get('count', 0)}\n\n"
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


def _journalist(req: ChatRequest, ctx: dict[str, Any]) -> dict[str, Any]:
    """Narrative-mode mock — short, plain English, with a Timeline."""
    clip = ctx.get("clip_id_short", "—")
    prose_text = (ctx.get("prose") or "").strip() or "(no narration on file)"
    faces = ctx.get("faces", {}) or {}
    n_subjects = faces.get("unique_subjects", 0)
    plates = ctx.get("plates", []) or []
    real_plates = [p for p in plates if p["text"].upper() not in
                   {"CAMERA", "CAMERAL", "EXIT", "STOP", "OPEN", "CLOSED"}]

    paras = [
        f"From the available clip footage, here is what unfolded "
        f"(clip `{clip}`).",
        prose_text[:600] + ("…" if len(prose_text) > 600 else ""),
    ]
    if n_subjects:
        paras.append(
            f"In total, **{n_subjects} distinct subject"
            f"{'s' if n_subjects != 1 else ''}** can be tracked across the "
            f"frames. No real license plates were captured — the OCR "
            f"system flagged " + ("none." if not real_plates else
            f"only generic strings (likely camera signage).")
        )

    timeline = []
    for t in (ctx.get("faces", {}) or {}).get("tracks", [])[:6]:
        timeline.append(f"- Subject {t['track_id']} first appears at {t['first_ts']:.1f}s "
                        f"and stays in frame until {t['last_ts']:.1f}s.")
    if not timeline:
        timeline = ["- (no track-level timeline available; rerun the pipeline "
                    "to populate face tracks)"]

    prose = (
        "\n\n".join(paras)
        + "\n\n**Timeline**\n" + "\n".join(timeline)
        + "\n\n*(Mock response — Journalist persona)*"
    )
    claims = [{"text": p, "confidence": 0.5, "frame_refs": [f"clip:{clip}"]}
              for p in paras[:4]]
    return {"prose": prose, "claims": claims}


_MOCKS = {
    "detective": _detective,
    "patrol": _patrol,
    "evidence_clerk": _evidence_clerk,
    "journalist": _journalist,
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
