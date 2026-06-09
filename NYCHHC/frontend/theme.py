"""NYC Health + Hospitals theme tokens + CSS injection + mandatory disclaimer banner.

Palette approximated from the NYC H+H brand (deep purple wordmark + accents). Swap
these hex values for the exact brand-guide colors when available — they're centralized
here on purpose.
"""

from __future__ import annotations

import streamlit as st

# ── Brand tokens (approximate NYC H+H) ───────────────────────────────────────
PURPLE = "#330072"        # primary (NYC H+H deep purple)
PURPLE_LT = "#6E2C9E"     # accent
TEAL = "#00A3AD"          # secondary
AMBER = "#F2A900"         # warning / alert
RED = "#C0392B"           # high risk
GREEN = "#1E8449"         # ok / low risk
INK = "#1B2631"

DISCLAIMER = "FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA"

BAND_COLOR = {"red": RED, "amber": AMBER, "green": GREEN}


def inject() -> None:
    """Inject brand CSS once per page."""
    st.markdown(
        f"""
        <style>
          .stApp {{ background: #f7f6fb; }}
          .nychhc-header {{
            background: linear-gradient(90deg, {PURPLE}, {PURPLE_LT});
            color: #fff; padding: 14px 20px; border-radius: 10px; margin-bottom: 6px;
          }}
          .nychhc-header h1 {{ font-size: 1.35rem; margin: 0; color:#fff; }}
          .nychhc-header .plus {{ color: {TEAL}; font-weight: 800; }}
          .nychhc-banner {{
            background: {AMBER}; color: #3b2f00; font-weight: 700; text-align: center;
            padding: 6px; border-radius: 6px; margin-bottom: 14px; letter-spacing: .3px;
            font-size: .82rem;
          }}
          .badge {{ color:#fff; padding: 2px 10px; border-radius: 12px; font-weight: 700; font-size:.8rem; }}
          .stButton>button {{ background: {PURPLE}; color:#fff; border:0; border-radius:6px; }}
          .stButton>button:hover {{ background: {PURPLE_LT}; color:#fff; }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def header(subtitle: str = "Predictive Hospital Workforce & Patient-Flow") -> None:
    st.markdown(
        f"""<div class="nychhc-header">
              <h1>NYC Health <span class="plus">+</span> Hospitals</h1>
              <div style="opacity:.9">{subtitle}</div>
            </div>""",
        unsafe_allow_html=True,
    )
    # Mandatory on every page (L10).
    st.markdown(f'<div class="nychhc-banner">⚠ {DISCLAIMER}</div>', unsafe_allow_html=True)


def badge(band: str) -> str:
    return f'<span class="badge" style="background:{BAND_COLOR.get(band, GREEN)}">{band.upper()}</span>'
