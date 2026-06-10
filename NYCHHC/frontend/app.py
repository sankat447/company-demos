"""NYC H+H — Predictive Hospital Workforce & Patient-Flow (role app + copilot).

DR-01 role switch · DR-02 schedule · DR-06 no-show badges · DR-08/09 coverage alert
· DR-05 PTO + impact · DR-10 dashboard · DR-11 copilot chat. FOR DEMONSTRATION ONLY.

Run locally:  NYCHHC_BACKEND_URL=http://localhost:8088 streamlit run app.py
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

import api_client as api
import theme

st.set_page_config(page_title="NYC H+H Workforce Copilot", page_icon="➕", layout="wide")
theme.inject()

# ── Sidebar: role (DR-01) + department ────────────────────────────────────────
with st.sidebar:
    st.markdown("### Role & Context")
    role = st.radio("Active role (DR-01)", ["Scheduler", "HR/Ops", "Provider"], index=0)
    try:
        depts = api.get("/api/data/departments")
        dept_map = {d["name"]: d["dept_id"] for d in depts}
    except Exception as e:  # backend down
        st.error(f"Backend unreachable: {e}")
        st.stop()
    dept_name = st.selectbox("Department", list(dept_map), index=0)
    dept_id = dept_map[dept_name]
    st.caption("Synthetic data · no PHI")

theme.header()

GREETING = {
    "Scheduler": "Scheduler view — coverage, no-show risk, and smart fills.",
    "HR/Ops": "HR / Operations view — PTO impact and workforce reporting.",
    "Provider": "Provider view — your schedule and patient-flow risk.",
}
st.caption(f"👤 {GREETING[role]}")

tab_dash, tab_sched, tab_risk, tab_pto, tab_copilot = st.tabs(
    ["📊 Dashboard", "🗓 Schedule", "🚦 No-Show Risk", "🌴 PTO", "💬 Copilot"]
)

# ── Dashboard (DR-10) + coverage alert (DR-08/09) ─────────────────────────────
with tab_dash:
    cov = api.get(f"/api/data/coverage/{dept_id}", days=14)
    understaffed = [c for c in cov if c["understaffed"]]
    risk = api.get("/api/data/appointments/risk", dept_id=dept_id, limit=50)
    pending = api.get("/api/data/pto", status="pending")
    red = sum(1 for r in risk if r["risk_band"] == "red")

    c1, c2, c3 = st.columns(3)
    c1.metric("Understaffed day-blocks (14d)", len(understaffed))
    c2.metric("High no-show appts", red)
    c3.metric("Pending PTO requests", len(pending))

    if understaffed:
        first = understaffed[0]
        st.warning(
            f"**Coverage alert** — {dept_name} is understaffed on **{first['date']}** "
            f"({first['block']}): need {first['required']:.0f}, have {first['projected']:.0f}. "
            "Ask the Copilot *“why is next Tuesday understaffed?”* for options."
        )
    else:
        st.success(f"{dept_name}: no coverage gaps forecast in the next 14 days.")

# ── Schedule (DR-02) ──────────────────────────────────────────────────────────
with tab_sched:
    rows = api.get("/api/data/schedule", dept_id=dept_id, days=14)
    if rows:
        df = pd.DataFrame(rows)
        st.dataframe(df, use_container_width=True, hide_index=True)
    else:
        st.info("No upcoming shifts.")

# ── No-Show Risk (DR-06) ──────────────────────────────────────────────────────
with tab_risk:
    risk = api.get("/api/data/appointments/risk", dept_id=dept_id, limit=25)
    st.caption("Risk badges from the No-Show KServe model (rules fallback if down).")
    for r in risk:
        cols = st.columns([1, 2, 2, 4])
        cols[0].markdown(theme.badge(r["risk_band"]), unsafe_allow_html=True)
        cols[1].write(f"#{r['appt_id']} · {r['patient_ref']}")
        cols[2].write(f"{r['risk_score']:.0%}")
        cols[3].caption(", ".join(r.get("drivers") or []))

# ── PTO + AI impact (DR-05) ───────────────────────────────────────────────────
with tab_pto:
    pending = api.get("/api/data/pto", status="pending")
    if not pending:
        st.info("No pending PTO requests.")
    for req in pending:
        with st.container(border=True):
            st.write(f"**PTO #{req['pto_id']}** — {req['provider']} · {req['start_date']} → {req['end_date']}")
            if st.button("Review impact & approve", key=f"pto-{req['pto_id']}"):
                out = api.post(f"/api/data/pto/{req['pto_id']}/decision", decision="approve")
                impact = out.get("coverage_impact", [])
                if impact:
                    st.warning(f"AI: approving creates {len(impact)} understaffed day-block(s):")
                    st.dataframe(pd.DataFrame(impact), use_container_width=True, hide_index=True)
                st.info(f"📝 Backfill proposal **{out['proposal_id']}** — {out['status']}. {out['note']}")

# ── Copilot chat (DR-11) ──────────────────────────────────────────────────────
with tab_copilot:
    st.caption("Grounded in workforce data + policy (RAG). Every answer is synthetic-data only.")
    if "history" not in st.session_state:
        st.session_state.history = []
    for msg in st.session_state.history:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
    prompt = st.chat_input("e.g. why is next Tuesday understaffed?")
    if prompt:
        st.session_state.history.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)
        with st.chat_message("assistant"):
            answer = st.write_stream(api.stream_chat(prompt, role))
        st.session_state.history.append({"role": "assistant", "content": answer})

st.divider()
st.caption(f"⚠ {theme.DISCLAIMER}")
