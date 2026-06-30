"""Conversation memory: per-session context + the 'apply all auto' follow-up."""

from __future__ import annotations

import pytest

from nychhc_copilot.agent.memory import SessionMemory
from nychhc_copilot.agent.react import route
from nychhc_copilot.config import Settings
from nychhc_copilot.scheduling import ensure_seeded, service as S
from nychhc_copilot.tools.providers import build_providers


@pytest.fixture()
def providers():
    p = build_providers(Settings())
    ensure_seeded(p.aurora)
    return p


def test_memory_history_is_bounded_and_isolated():
    m = SessionMemory(max_msgs=4)
    for i in range(6):
        m.append("s1", "user", f"m{i}")
    assert len(m.history("s1")) == 4 and m.history("s1")[0]["content"] == "m2"
    assert m.history("s2") == []  # sessions are isolated


def test_followup_apply_uses_last_pto_context(providers):
    mem = SessionMemory()
    sid = "sess-A"
    # Pre-book OB appts so Dr. Chen's PTO window has impact to apply.
    S.book_appointment(providers.aurora, "PT0088", "p1", "2026-06-17", "10:00", type="Follow-up")
    S.book_appointment(providers.aurora, "PT0134", "p1", "2026-06-17", "11:00", type="Follow-up")
    first = route("Put Dr. Chen on PTO 6/16-6/20 and show the impact", providers,
                  role="Scheduler", memory=mem, session_id=sid)
    assert first and "impact" in first.lower()
    assert mem.get_context(sid, "pending_pto_apply"), "router should remember the PTO context"
    second = route("apply all auto", providers, role="Scheduler", memory=mem, session_id=sid)
    assert second and "applied" in second.lower()
    assert mem.get_context(sid, "pending_pto_apply") is None  # consumed
    assert any(a["action"] == "pto_reassign" for a in S.recent_audit(providers.aurora))


def test_followup_without_context_does_not_apply(providers):
    mem = SessionMemory()
    assert route("apply all auto", providers, role="Scheduler", memory=mem, session_id="z") is None


def test_provider_cannot_apply_followup(providers):
    mem = SessionMemory()
    sid = "sess-B"
    S.book_appointment(providers.aurora, "PT0088", "p1", "2026-06-17", "10:00", type="Follow-up")
    route("Put Dr. Chen on PTO 6/16-6/20 and show the impact", providers,
          role="Scheduler", memory=mem, session_id=sid)
    out = route("yes", providers, role="Provider", memory=mem, session_id=sid)
    assert out and "scheduler" in out.lower()
