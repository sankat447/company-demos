"""Tests for the Pydantic schemas in app.schemas."""
from __future__ import annotations


def test_persona_response_with_pending_id_clones():
    from app.schemas import Claim, PersonaResponse, Provenance

    base = PersonaResponse(
        persona="detective",
        prose="hello",
        claims=[Claim(text="x", confidence=0.5, frame_refs=["clip:abc"])],
        provenance=Provenance(clip_ids=["c1"], narration_ids=["n1"]),
    )
    cloned = base.with_pending_id("pid-1")
    assert base.pending_approval_id is None
    assert cloned.pending_approval_id == "pid-1"
    assert cloned.prose == base.prose
    assert cloned.claims == base.claims


def test_chat_request_clamps_k():
    import pydantic
    from app.schemas import ChatRequest

    assert ChatRequest(q="hi").k == 8
    assert ChatRequest(q="hi", k=1).k == 1
    try:
        ChatRequest(q="hi", k=100)
    except pydantic.ValidationError:
        pass
    else:
        raise AssertionError("k=100 should have been rejected (max=32)")
