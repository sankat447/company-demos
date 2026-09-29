"""Direct Anthropic Messages API client for persona /chat in claude mode.

Bypasses Portkey — the demo's Portkey instance has no Anthropic virtual
key configured, so we hit api.anthropic.com directly from the persona
pod. The API key is mounted from the pd-anthropic-key Secret.

We send TEXT-ONLY prompts. The persona's clip context (Qwen-VL prose,
plate readings, face counts, transcript snippets) has already been
extracted on-cluster and is included in the user message as text. No
video, image, or audio is ever forwarded to Anthropic.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

log = logging.getLogger(__name__)

_API_URL = "https://api.anthropic.com/v1/messages"
_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
_DEFAULT_MODEL = os.environ.get(
    "ANTHROPIC_MODEL",
    "claude-sonnet-4-5",
)
_TIMEOUT = float(os.environ.get("ANTHROPIC_TIMEOUT_SEC", "60"))
_API_VERSION = "2023-06-01"
# Big enough that a Detective-style multi-section response with claims
# and frame_refs doesn't truncate mid-JSON. 1024 was clipping the model
# at the closing brace, which made chat_json fall back and dump the
# whole raw JSON into the chat as text.
_DEFAULT_MAX_TOKENS = int(os.environ.get("ANTHROPIC_MAX_TOKENS", "4096"))


def _model_alias(model: str) -> str:
    """Map persona's 'claude-sonnet-4' alias to a real Anthropic model id."""
    aliases = {
        "claude-sonnet-4":   "claude-sonnet-4-5",
        "claude-sonnet-4-5": "claude-sonnet-4-5",
        "claude-opus-4":     "claude-opus-4-1",
        "claude-haiku-4":    "claude-haiku-4-5",
    }
    return aliases.get(model, model)


def chat(system: str, user: str, *, max_tokens: int | None = None,
         temperature: float = 0.3, model: str | None = None) -> str:
    """Single-turn chat against Anthropic. Returns the text content.

    Enables Anthropic prompt caching on the SYSTEM message. The persona
    system prompt is a stable ~2000-token block (detective.md, patrol.md,
    etc.) — caching it gives a large TTFT reduction on the 2nd..Nth
    request within the 5-minute cache window. First request writes the
    cache (~$0.01 extra); subsequent hits read the cache at ~10% of the
    normal input-token cost.
    """
    if not _API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not set; cannot call Claude")
    payload = {
        "model": _model_alias(model or _DEFAULT_MODEL),
        "max_tokens": int(max_tokens) if max_tokens else _DEFAULT_MAX_TOKENS,
        "temperature": temperature,
        # System as a list-of-blocks with cache_control on the (only) block —
        # this is the prompt-caching API shape. The plain-string form is
        # NOT cached automatically.
        "system": [
            {"type": "text", "text": system,
             "cache_control": {"type": "ephemeral"}},
        ],
        "messages": [{"role": "user", "content": user}],
    }
    headers = {
        "x-api-key": _API_KEY,
        "anthropic-version": _API_VERSION,
        "content-type": "application/json",
    }
    with httpx.Client(timeout=_TIMEOUT) as cli:
        resp = cli.post(_API_URL, json=payload, headers=headers)
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
    usage = data.get("usage", {})
    log.info("anthropic call: in=%s cache_read=%s cache_create=%s out=%s",
             usage.get("input_tokens"), usage.get("cache_read_input_tokens"),
             usage.get("cache_creation_input_tokens"), usage.get("output_tokens"))
    blocks = data.get("content") or []
    return "".join(b.get("text", "") for b in blocks if b.get("type") == "text")


def chat_stream(system: str, user: str, *, max_tokens: int | None = None,
                temperature: float = 0.3, model: str | None = None):
    """Stream chat tokens from Anthropic. Yields (event_name, event_data)
    tuples so the caller can forward to SSE. Terminal event is
    ("done", {"full_text": "<concatenated>", "usage": {…}}).

    Anthropic's streaming API emits SSE events like:
        event: message_start
        event: content_block_start
        event: content_block_delta   ← the token stream lives here
        event: content_block_stop
        event: message_delta
        event: message_stop
    We surface only content_block_delta as ("token", text) events and
    aggregate the full text so the caller can persist it after the stream.
    """
    if not _API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not set; cannot call Claude")
    payload = {
        "model": _model_alias(model or _DEFAULT_MODEL),
        "max_tokens": int(max_tokens) if max_tokens else _DEFAULT_MAX_TOKENS,
        "temperature": temperature,
        "system": [
            {"type": "text", "text": system,
             "cache_control": {"type": "ephemeral"}},
        ],
        "messages": [{"role": "user", "content": user}],
        "stream": True,
    }
    headers = {
        "x-api-key": _API_KEY,
        "anthropic-version": _API_VERSION,
        "content-type": "application/json",
    }
    full = []
    final_usage: dict[str, Any] = {}
    with httpx.Client(timeout=_TIMEOUT) as cli:
        with cli.stream("POST", _API_URL, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            for raw in resp.iter_lines():
                if not raw or not raw.startswith("data: "):
                    continue
                blob = raw[6:].strip()
                if blob == "[DONE]":
                    break
                try:
                    ev = json.loads(blob)
                except json.JSONDecodeError:
                    continue
                t = ev.get("type", "")
                if t == "content_block_delta":
                    delta = ev.get("delta", {})
                    text_delta = delta.get("text", "")
                    if text_delta:
                        full.append(text_delta)
                        yield ("token", text_delta)
                elif t == "message_delta":
                    # Anthropic emits `usage` on message_delta with final counts
                    final_usage.update(ev.get("usage", {}))
                elif t == "message_start":
                    # Initial usage snapshot (input_tokens + cache info)
                    m = ev.get("message", {})
                    final_usage.update(m.get("usage", {}))
    full_text = "".join(full)
    log.info("anthropic stream: chars=%d usage=%s", len(full_text), final_usage)
    yield ("done", {"full_text": full_text, "usage": final_usage})


def chat_json(system: str, user: str, **kw: Any) -> dict[str, Any]:
    """Chat that expects a JSON object back. Tolerates fenced code blocks
    and stray preamble/postscript by extracting the outermost {...} body.
    On any parse failure, falls back to {prose: <model's text>, claims: []}
    so the UI still gets a readable answer (rendered as markdown)."""
    text = chat(system, user, **kw)
    txt = text.strip()
    # Strip optional ```json ... ``` fence
    if txt.startswith("```"):
        first_nl = txt.find("\n")
        if first_nl != -1:
            txt = txt[first_nl + 1:]
        if txt.rstrip().endswith("```"):
            txt = txt.rstrip()[:-3]
        txt = txt.strip()
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        # Try to slice out the outermost JSON object and retry; the model
        # sometimes prepends a sentence like "Here is the JSON:".
        first = txt.find("{")
        last = txt.rfind("}")
        if first != -1 and last > first:
            try:
                return json.loads(txt[first:last + 1])
            except json.JSONDecodeError:
                pass
        log.warning("Claude returned non-JSON (len=%d); falling back to "
                    "{prose: <text>}", len(text))
        return {"prose": text, "claims": []}
