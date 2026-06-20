"""Agent tools — each calls a deterministic in-cluster service over http.

The agent NEVER computes numbers; these tools return verified facts that the LLM
may then narrate. retrieve() returns DE-IDENTIFIED chunks only (tokens, no NPI).
"""
from __future__ import annotations

import httpx

from app.common import config

_TIMEOUT = 15.0


def get_metrics(report_id_a, report_id_b, year_a, year_b) -> dict:
    r = httpx.post(f"{config.METRICS_ENGINE_URL}/compare",
                   json={"report_id_a": report_id_a, "report_id_b": report_id_b,
                         "year_a": year_a, "year_b": year_b}, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()


def flag_policy(report_id) -> dict:
    r = httpx.post(f"{config.METRICS_ENGINE_URL}/flag_policy",
                   json={"report_id": report_id}, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()


def compute_scenario(report_id, shock_bps=200) -> dict:
    r = httpx.post(f"{config.METRICS_ENGINE_URL}/scenario",
                   json={"report_id": report_id, "shock_bps": shock_bps}, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()


def retrieve(query, report_id=None, k=5) -> dict:
    r = httpx.post(f"{config.DEID_GATEWAY_URL}/retrieve",
                   json={"query": query, "report_id": report_id, "k": k}, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()


# OpenAI-style tool schemas advertised to the LLM via Portkey.
TOOL_SCHEMAS = [
    {"type": "function", "function": {
        "name": "get_metrics", "description": "Verified year-over-year comparison of portfolio metrics.",
        "parameters": {"type": "object", "properties": {
            "report_id_a": {"type": "string"}, "report_id_b": {"type": "string"},
            "year_a": {"type": "integer"}, "year_b": {"type": "integer"}},
            "required": ["report_id_a", "report_id_b", "year_a", "year_b"]}}},
    {"type": "function", "function": {
        "name": "flag_policy", "description": "Deterministic policy risk flags for a report.",
        "parameters": {"type": "object", "properties": {"report_id": {"type": "string"}},
                       "required": ["report_id"]}}},
    {"type": "function", "function": {
        "name": "compute_scenario", "description": "Rate-shock sensitivity (not a forecast).",
        "parameters": {"type": "object", "properties": {
            "report_id": {"type": "string"}, "shock_bps": {"type": "integer"}},
            "required": ["report_id"]}}},
    {"type": "function", "function": {
        "name": "retrieve", "description": "Similarity search over DE-IDENTIFIED report notes (tokens only).",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"}, "report_id": {"type": "string"}, "k": {"type": "integer"}},
            "required": ["query"]}}},
]

DISPATCH = {"get_metrics": get_metrics, "flag_policy": flag_policy,
            "compute_scenario": compute_scenario, "retrieve": retrieve}
