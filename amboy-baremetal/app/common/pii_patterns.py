"""
Canonical synthetic-PII recognizers for the Amboy NPI-Safe demo.

ONE source of truth, reused by:
  - data/generate.py         (assert generated PII falls only in safe fiction ranges)
  - tests/privacy_invariants.py (scan de-id output / prompts / audit for any leak)
  - app/deid_gateway custom Presidio recognizers (detect bank-specific NPI in prose)

Design notes
------------
* Detection patterns are deliberately broad — they must catch NPI in messy free
  text ("SSN ending 6789", an address restated mid-sentence), not just tidy columns.
* The *safe-range* helpers encode the synthetic-only constraints from the spec so
  the generator can prove it never emits a real-world-issuable identifier.
"""
import re

# ── Detection patterns (broad — used to FIND any NPI-shaped token) ───────────
SSN_RE = re.compile(r"\b(\d{3})[-\s]?(\d{2})[-\s]?(\d{4})\b")
# "SSN ending 6789", "ssn ending in 6789", "SSN last 4: 6789" — the `.` gap
# tolerates a decoy digit (the "4" in "last 4") before the real 4-digit group.
SSN_LAST4_RE = re.compile(r"(?i)\bssn\b.{0,25}?(\d{4})\b")
# Our OWN de-id tokens — NOT NPI. Stripped before scanning so the privacy
# invariant test never counts a token (whose hex may contain 4 digits) as a leak.
TOKEN_RE = re.compile(r"\[[A-Z_]+:[0-9a-fA-F]+\]")
# A separator (space/dot/dash or parens) between the groups is REQUIRED so bare
# 10-digit financial figures (e.g. 1482000000 total assets) are not misread as
# phones. Groups: (1) area (2) exchange (3) subscriber. Our synthetic phones —
# "(732) 555-0142", "732-555-0142", "732.555.0142", "+1 732 555 0142" — all match.
PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?1[-.\s])?\(?(\d{3})\)?[-.\s](\d{3})[-.\s](\d{4})\b"
)
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
# NOTE: account/loan-number detection is intentionally NOT a regex rule — it is
# meant to be learned by the PII model (see the Model Training console). Do not
# re-add an ACCOUNT recognizer here.
# Street address: number + name + common suffix (catches restated addresses in prose)
ADDRESS_RE = re.compile(
    r"\b\d{1,6}\s+[A-Z][A-Za-z0-9.\-]*(?:\s+[A-Z][A-Za-z0-9.\-]*){0,3}\s+"
    r"(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|"
    r"Way|Ter|Terrace|Pl|Place|Cir|Circle)\b\.?",
    re.IGNORECASE,
)

# Entity label -> compiled detector. Used by the privacy scan to report WHAT leaked.
DETECTORS = {
    "US_SSN": SSN_RE,
    "US_SSN_LAST4": SSN_LAST4_RE,
    "PHONE_NUMBER": PHONE_RE,
    "EMAIL_ADDRESS": EMAIL_RE,
    "STREET_ADDRESS": ADDRESS_RE,
}

# ── Safe synthetic ranges (generator MUST stay inside these) ─────────────────
# SSN area numbers never issued by the SSA: 000 and 900-999.
SAFE_SSN_AREAS = ["000"] + [str(n) for n in range(900, 1000)]
# Phone exchange 555 + subscriber 0100-0199 is reserved for fiction (TV/movies).
SAFE_PHONE_EXCHANGE = "555"
SAFE_PHONE_SUBSCRIBER_LO = 100
SAFE_PHONE_SUBSCRIBER_HI = 199
# Reserved / non-deliverable email domains (RFC 2606 / 6761).
SAFE_EMAIL_DOMAINS = ["example.com", "example.org", "example.net", "fiction.invalid"]


def ssn_is_synthetic(ssn: str) -> bool:
    """True iff the SSN's area is an never-issued (000 / 900-999) block."""
    m = SSN_RE.search(ssn)
    return bool(m) and m.group(1) in SAFE_SSN_AREAS


def phone_is_synthetic(phone: str) -> bool:
    """True iff exchange==555 and subscriber in the reserved 0100-0199 block."""
    m = PHONE_RE.search(phone)
    if not m:
        return False
    exchange, subscriber = m.group(2), int(m.group(3))
    return exchange == SAFE_PHONE_EXCHANGE and (
        SAFE_PHONE_SUBSCRIBER_LO <= subscriber <= SAFE_PHONE_SUBSCRIBER_HI
    )


def email_is_synthetic(email: str) -> bool:
    return any(email.lower().endswith("@" + d) or email.lower().endswith("." + d)
               for d in SAFE_EMAIL_DOMAINS)


def scan(text: str):
    """Return list of (entity_label, matched_text) for every NPI hit in `text`.

    The privacy-invariant tests use this to assert ZERO hits past the trust
    boundary. Tokens of the form [ENTITY:hex] are intentionally NOT matched.
    """
    hits = []
    if not text:
        return hits
    text = TOKEN_RE.sub(" ", text)  # our own tokens are not NPI
    for label, rx in DETECTORS.items():
        for m in rx.finditer(text):
            hits.append((label, m.group(0)))
    return hits
