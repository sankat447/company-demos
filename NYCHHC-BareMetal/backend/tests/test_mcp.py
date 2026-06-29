"""Offline test of the MCP server tool surface."""

from __future__ import annotations

import pytest

from nychhc_copilot import mcp_server as M


@pytest.mark.asyncio
async def test_mcp_exposes_the_four_tools_and_disclaimer():
    tools = await M.mcp.list_tools()
    names = {t.name for t in tools}
    assert {"query_workforce_db", "no_show_risk", "coverage_forecast", "propose_schedule_change"} <= names

    resources = await M.mcp.list_resources()
    assert any(str(r.uri).startswith("disclaimer://") for r in resources)


def test_mcp_query_tool_guards_writes():
    assert "rejected" in M.query_workforce_db("UPDATE providers SET name='x'").lower()


def test_mcp_schedule_change_needs_approval():
    out = M.propose_schedule_change("Backfill Emergency Tue")
    assert "approval required" in out.lower()
