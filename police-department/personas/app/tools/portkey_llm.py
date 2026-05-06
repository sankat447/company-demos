"""Thin client to call Llama 3.1 8B via the existing Portkey gateway.

Portkey at portkey.ai-demo.svc:8787 proxies an OpenAI-compatible API to
the platform's `llama-3-1-8b` InferenceService. The persona graphs use
this single entrypoint so retries, rate limiting, and observability all
flow through the platform's gateway rather than per-persona logic.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

log = logging.getLogger(__name__)

_BASE_URL = os.environ.get(
    "PORTKEY_URL",
    "http://portkey.ai-demo.svc.cluster.local:8787/v1/chat/completions",
)
_MODEL = os.environ.get("PORTKEY_MODEL", "llama-3-1-8b")
_API_KEY = os.environ.get("PORTKEY_API_KEY", "")
_TIMEOUT = float(os.environ.get("PORTKEY_TIMEOUT_SEC", "120"))


def chat(system: str, user: str, *, max_tokens: int = 768,
         temperature: float = 0.3, model: str | None = None) -> str:
    payload = {
        "model": model or _MODEL,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
    }
    headers = {"Content-Type": "application/json"}
    if _API_KEY:
        headers["x-portkey-api-key"] = _API_KEY

    with httpx.Client(timeout=_TIMEOUT) as cli:
        resp = cli.post(_BASE_URL, json=payload, headers=headers)
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
    return data["choices"][0]["message"]["content"]


def chat_json(system: str, user: str, **kw: Any) -> dict[str, Any]:
    """Same as `chat`, but coerce the response to JSON (best-effort)."""
    raw = chat(system, user, **kw)
    raw = raw.strip()
    # Common LLM artefact: leading ```json ... ``` fences.
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        log.warning("portkey response not JSON; falling back to {prose}")
        return {"prose": raw}
