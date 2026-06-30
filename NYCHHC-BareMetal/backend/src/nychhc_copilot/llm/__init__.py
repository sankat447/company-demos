"""LLM access — ALL traffic via the Portkey gateway (Lesson L5).

Never import an OpenAI/Anthropic/vLLM client directly elsewhere; go through here.
"""

from .portkey import build_chat_model, build_chat_model_with_fallback

__all__ = ["build_chat_model", "build_chat_model_with_fallback"]
