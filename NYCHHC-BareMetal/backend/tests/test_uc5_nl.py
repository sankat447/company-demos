"""UC5 — NL hardening: out-of-scope decline, clarify, role-permitted actions (BR-9)."""

from __future__ import annotations

import pytest

from nychhc_copilot.agent.react import route
from nychhc_copilot.config import Settings
from nychhc_copilot.scheduling import ensure_seeded
from nychhc_copilot.tools.providers import build_providers


@pytest.fixture()
def providers():
    p = build_providers(Settings())
    ensure_seeded(p.aurora)
    return p


def test_out_of_scope_declines(providers):
    out = route("Show me the nursing schedule for tonight", providers)
    assert out and "out of scope" in out.lower()


def test_ambiguous_cover_asks_for_date(providers):
    out = route("who can cover Dr. Chen?", providers)
    assert out and "which date" in out.lower()


def test_cover_with_specialty_is_answered(providers):
    out = route("which obstetrics providers have openings?", providers)
    assert out and "which date" not in out.lower()


def test_provider_role_cannot_cancel(providers):
    out = route("Cancel the appointment for Daniel Brooks", providers, role="Provider")
    assert out and "scheduler" in out.lower()


def test_scheduler_role_can_cancel(providers):
    out = route("Cancel the appointment for Daniel Brooks", providers, role="Scheduler")
    assert out and "cancelled" in out.lower()
