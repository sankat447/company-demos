"""Portkey gateway client (Lesson L5).

Portkey exposes an OpenAI-compatible API, so we use ``langchain_openai.ChatOpenAI``
pointed at the gateway. `base_url` may be the cluster svc OR Portkey's Route — see
config.py / ARCHITECTURE.md D1 (STRICT-mTLS-from-outside-mesh).

Two failure-tolerance layers:
  1. Portkey itself does primary→fallback routing (configured in the gateway).
  2. `build_chat_model_with_fallback` adds a client-side LangChain `.with_fallbacks`
     so a primary-model error transparently retries on the fallback model alias.
"""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from ..config import Settings


def _portkey_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {}
    # On baremetal the provider is Anthropic (Claude via Portkey) — the proven amboy
    # setup on this same stack: send x-portkey-provider and let the provider API key
    # ride as the Authorization bearer (ChatOpenAI api_key below). A separate Portkey
    # virtual key is optional.
    if settings.portkey_provider:
        headers["x-portkey-provider"] = settings.portkey_provider
    if settings.portkey_virtual_key:
        headers["x-portkey-virtual-key"] = settings.portkey_virtual_key
    return headers


def _base_url(settings: Settings) -> str:
    # OpenAI-compatible surface lives under /v1.
    return settings.portkey_base_url.rstrip("/") + "/v1"


def build_chat_model(settings: Settings, model: str | None = None) -> ChatOpenAI:
    """A ChatOpenAI bound to one model alias, routed through Portkey."""
    kwargs: dict = {}
    # The Portkey Route uses the cluster's self-signed ingress cert; optionally skip
    # verification for that internal route (demo only). Sync + async clients both.
    if not settings.portkey_verify_ssl:
        import httpx

        kwargs["http_client"] = httpx.Client(verify=False)
        kwargs["http_async_client"] = httpx.AsyncClient(verify=False)
    return ChatOpenAI(
        model=model or settings.primary_model,
        base_url=_base_url(settings),
        api_key=settings.portkey_api_key or "dummy",  # required non-empty by client
        default_headers=_portkey_headers(settings),
        temperature=settings.llm_temperature,
        timeout=settings.llm_request_timeout_s,
        max_retries=1,
        streaming=True,
        max_tokens=settings.llm_max_tokens,
        # Halt if a small model starts fabricating the next dialogue turn.
        stop=["\nuser:", "\nUser:", "\nassistant:", "\nHuman:"],
        **kwargs,
    )


def build_chat_model_with_fallback(settings: Settings):
    """Primary model with a client-side fallback to the fallback alias.

    Returns a Runnable usable anywhere a chat model is expected (incl. as the
    model for a ReAct agent), so the live demo degrades gracefully if the
    primary model errors at the gateway.
    """
    primary = build_chat_model(settings, settings.primary_model)
    if not settings.fallback_model or settings.fallback_model == settings.primary_model:
        return primary
    fallback = build_chat_model(settings, settings.fallback_model)
    return primary.with_fallbacks([fallback])
