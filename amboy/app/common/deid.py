"""De-identification engine — runs BEFORE the trust boundary.

Strategy: union of two detectors, then deterministic token replacement.
  1. Presidio analyzer (official CPU service) + our custom bank ad-hoc recognizers
     — catches PERSON / LOCATION / context-dependent PII.
  2. Our regex recognizers (pii_patterns) — a DETERMINISTIC sweep that guarantees
     the regex-detectable privacy invariant even if Presidio is unreachable.
Spans are merged (overlaps resolved) and replaced right-to-left with a stable
[ENTITY:hex] token. Same value -> same token (tokenizer is deterministic).
"""
from __future__ import annotations

import httpx

from . import config, pii_patterns

# Normalize detector labels -> compact token entity types.
_LABEL_MAP = {
    "US_SSN": "US_SSN", "US_SSN_LAST4": "US_SSN", "PHONE_NUMBER": "PHONE",
    "EMAIL_ADDRESS": "EMAIL", "STREET_ADDRESS": "ADDRESS", "LOCATION": "ADDRESS",
    "PERSON": "PERSON", "CREDIT_CARD": "CREDIT_CARD", "IBAN_CODE": "IBAN",
    "ACCOUNT_NUMBER": "ACCOUNT", "ACCOUNT_NUMBER_PROSE": "ACCOUNT",
}

# Custom Presidio ad-hoc recognizers (bank prose our broad regexes encode).
AD_HOC_RECOGNIZERS = [
    {
        "name": "amboy_ssn_last4",
        "supported_entity": "US_SSN",
        "patterns": [{"name": "ssn_last4_prose",
                      "regex": pii_patterns.SSN_LAST4_RE.pattern, "score": 0.85}],
    },
    {
        "name": "amboy_fiction_phone",
        "supported_entity": "PHONE_NUMBER",
        "patterns": [{"name": "phone_555_block",
                      "regex": pii_patterns.PHONE_RE.pattern, "score": 0.8}],
    },
    {
        "name": "amboy_account",
        "supported_entity": "ACCOUNT_NUMBER",
        "patterns": [{"name": "amb_loan_id",
                      "regex": pii_patterns.ACCOUNT_RE.pattern, "score": 0.9}],
    },
]


def presidio_spans(text: str):
    """Spans from Presidio. Returns [] on any failure (regex sweep still guards)."""
    try:
        r = httpx.post(
            f"{config.PRESIDIO_ANALYZER_URL}/analyze",
            json={"text": text, "language": "en",
                  "ad_hoc_recognizers": AD_HOC_RECOGNIZERS},
            timeout=10.0)
        r.raise_for_status()
        return [(d["start"], d["end"], d["entity_type"]) for d in r.json()]
    except Exception:
        return []


def regex_spans(text: str):
    spans = []
    for label, rx in pii_patterns.DETECTORS.items():
        for m in rx.finditer(text):
            spans.append((m.start(), m.end(), label))
    return spans


def _merge(spans):
    """Resolve overlaps: prefer earlier start, then longer span."""
    spans = sorted(spans, key=lambda s: (s[0], -(s[1] - s[0])))
    out, last_end = [], -1
    for start, end, label in spans:
        if start >= last_end:
            out.append((start, end, label))
            last_end = end
    return out


def deidentify_text(text: str, tokenizer, on_token=None) -> str:
    """Replace every detected PII span in `text` with a stable token.

    on_token(token, entity_type, original_value) is called per unique replacement
    so the caller can persist token_vault. Returns token-only text.
    """
    if not text:
        return text
    spans = _merge(presidio_spans(text) + regex_spans(text))
    # Replace right-to-left so earlier offsets stay valid.
    for start, end, label in sorted(spans, key=lambda s: s[0], reverse=True):
        value = text[start:end]
        etype = _LABEL_MAP.get(label, label)
        token = tokenizer.token(etype, value)
        if on_token:
            on_token(token, etype, value)
        text = text[:start] + token + text[end:]
    return text


def deidentify_value(entity_type: str, value: str, tokenizer, on_token=None) -> str:
    """Tokenize a known structured field (we already know its entity type)."""
    etype = _LABEL_MAP.get(entity_type, entity_type)
    token = tokenizer.token(etype, value)
    if on_token:
        on_token(token, etype, value)
    return token
