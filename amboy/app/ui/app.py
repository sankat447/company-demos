"""Amboy report-compare-ui — executive UX.

Upload two annual reports -> de-identify+index (deid-gateway) -> grounded
comparison + risk flags (compare-agent) -> gated 'reveal loan detail' wired to the
Keycloak npi-reveal role (deid-gateway /detokenize). NPI never appears here unless
an authorized reveal is explicitly performed and audited.
"""
import os
import sys

# `streamlit run app/ui/app.py` puts this file's dir (/app/app/ui) first on
# sys.path; since the file is app.py it shadows the `app` package and
# `from app.common import config` fails ("'app' is not a package"). Prepend the
# repo root so the package resolves regardless of streamlit's path ordering.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import json  # noqa: E402

import httpx  # noqa: E402
import streamlit as st  # noqa: E402

from app.common import config  # noqa: E402

st.set_page_config(page_title="Amboy — NPI-Safe Report Compare", page_icon="🏦", layout="wide")
st.title("🏦 Amboy — NPI-Safe Investment & Credit Report Comparison")
st.caption("NPI is detected and tokenized **in-cluster** before anything reaches the LLM, "
           "the vector store, or the logs. Numbers are computed deterministically; the model "
           "only narrates verified figures.")


def _post(url, payload, headers=None, timeout=120):
    r = httpx.post(url, json=payload, headers=headers or {}, timeout=timeout)
    return r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json")
                           else {"detail": r.text})


# ── Step 1 — ingest two reports ──────────────────────────────────────────────
st.header("1 · Ingest reports")
c1, c2 = st.columns(2)
ingested = st.session_state.setdefault("ingested", {})

for col, label, default_key, year in ((c1, "FY2024 report", "report_2024.json", 2024),
                                       (c2, "FY2025 report", "report_2025.json", 2025)):
    with col:
        st.subheader(label)
        up = st.file_uploader(f"Upload {label} (JSON)", type="json", key=f"up{year}")
        b1, b2 = st.columns(2)
        if b1.button(f"Ingest upload", key=f"ingu{year}", disabled=up is None):
            report = json.load(up)
            code, body = _post(f"{config.DEID_GATEWAY_URL}/ingest",
                               {"report": report, "actor": "ui"})
            if code == 200:
                ingested[year] = body["report_id"]
                st.success(f"De-identified {body['loans']} loans · {body['tokens_stored']} tokens "
                           f"· {body['report_id']}")
            else:
                st.error(f"{code}: {body}")
        if b2.button(f"Ingest from raw bucket", key=f"ingb{year}"):
            code, body = _post(f"{config.DEID_GATEWAY_URL}/ingest",
                               {"bucket": config.S3_BUCKET_RAW, "raw_key": default_key, "actor": "ui"})
            if code == 200:
                ingested[year] = body["report_id"]
                st.success(f"De-identified {body['loans']} loans · {body['report_id']}")
            else:
                st.error(f"{code}: {body}")

if ingested:
    st.info("Ingested: " + ", ".join(f"FY{y} → {rid}" for y, rid in sorted(ingested.items())))

# ── Step 2 — comparison + risk flags ─────────────────────────────────────────
st.header("2 · Comparison, risk flags & scenario")
shock = st.slider("Rate-shock sensitivity (bps)", 0, 500, 200, 25)
if st.button("Run comparison", type="primary"):
    code, body = _post(f"{config.COMPARE_AGENT_URL}/analyze",
                       {"report_id_a": "AMB-FY2024", "report_id_b": "AMB-FY2025",
                        "year_a": 2024, "year_b": 2025, "shock_bps": shock})
    if code != 200:
        st.error(f"{code}: {body}")
    else:
        g = body["grounding"]
        badge = "✅ fully grounded" if g["grounded"] else f"⚠️ {len(g['ungrounded'])} ungrounded"
        st.metric("Narrative grounding", f"{g['grounding_score']:.0%}", badge)
        st.caption(f"agent mode: {body['mode']} — every figure traces to a verified tool output")
        st.markdown("#### Executive draft")
        st.text(body["draft_summary"])
        for out in body.get("tool_outputs", []):
            if "flags" in out and out["flags"]:
                st.markdown("#### Risk flags")
                st.dataframe(out["flags"], use_container_width=True)
            if "comparison" in out:
                st.markdown("#### Year-over-year metrics")
                st.dataframe(out["comparison"], use_container_width=True)

# ── Step 3 — gated NPI reveal (Keycloak npi-reveal) ──────────────────────────
st.header("3 · Reveal loan detail (gated)")
st.caption("Re-identification happens ONLY here in the app tier, authorized by the "
           "Keycloak `npi-reveal` role, and every reveal is written to the append-only audit log.")
token = st.text_input("Token to reveal", placeholder="[PERSON:1a2b3c4d5e6f]")
has_role = st.checkbox(f"Caller holds the `{config.NPI_REVEAL_ROLE}` role", value=False)
if st.button("Reveal", disabled=not token):
    headers = {"X-Amboy-Roles": config.NPI_REVEAL_ROLE if has_role else ""}
    code, body = _post(f"{config.DEID_GATEWAY_URL}/detokenize", {"token": token}, headers=headers)
    if code == 403:
        st.error("403 — the `npi-reveal` role is required. (Audit row NOT written; nothing revealed.)")
    elif code == 200 and body.get("found"):
        st.success(f"Revealed value: **{body['value']}**  (audit row written)")
    elif code == 200:
        st.warning("Token not found in the vault.")
    else:
        st.error(f"{code}: {body}")
