"""Thin client for the copilot backend — data API (JSON) + chat (SSE stream)."""

from __future__ import annotations

import json
import os
from typing import Iterator

import requests

# In-cluster: the backend Service. Local: the uvicorn dev server.
BACKEND = os.environ.get("NYCHHC_BACKEND_URL", "http://localhost:8088").rstrip("/")
_TIMEOUT = 30


def get(path: str, **params):
    r = requests.get(f"{BACKEND}{path}", params=params, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json().get("data")


def post(path: str, **params):
    r = requests.post(f"{BACKEND}{path}", params=params, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json().get("data")


def stream_chat(message: str, role: str) -> Iterator[str]:
    """Yield answer text chunks from the backend SSE /api/chat (DR-11)."""
    with requests.post(
        f"{BACKEND}/api/chat",
        json={"message": message, "role": role},
        stream=True,
        timeout=120,
    ) as r:
        r.raise_for_status()
        event = None
        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: ") and event == "token":
                yield json.loads(line[6:]).get("text", "")


def health() -> dict:
    return requests.get(f"{BACKEND}/health", timeout=5).json()
