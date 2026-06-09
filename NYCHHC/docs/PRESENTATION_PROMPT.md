# Presentation prompt (paste into claude.ai)

Copy everything between PROMPT START and PROMPT END into a new claude.ai chat to
generate the deck. Edit the bracketed `[...]` bits first if you want.

---

## PROMPT START

You are a senior solutions architect and presentation designer. Create a polished,
executive-ready **slide presentation** for **NYC Health + Hospitals leadership**
(CMIO, CIO, clinical informaticists, nursing & operations leaders) that showcases a
working agentic-AI demo we built, and paints a credible picture of the **future of AI
in the hospital**.

Audience: technical-but-time-poor health-system executives. Tone: confident, concrete,
trustworthy, not hypey. Length: **~14 slides**, ~15-minute talk. Include **speaker
notes** under each slide.

**Output format:** produce a single **self-contained HTML slide deck** (reveal.js via
CDN is fine) as an artifact — 16:9, arrow-key navigation, clean and modern. Brand it
**NYC Health + Hospitals**: deep navy blue (#003DA5), NYC orange accent (#FF6900),
white, generous whitespace, a humanist serif for headlines + clean sans for body. Put
a small persistent footer on every slide: "FOR DEMONSTRATION ONLY — NOT FOR CLINICAL
USE — SYNTHETIC DATA." (If I later ask for PowerPoint, regenerate as a .pptx.)

Do not invent statistics or clinical claims. Use the facts below; where you need a
number for impact framing, label it clearly as illustrative.

### What the demo is (use this — it's accurate)

"**Predictive Hospital Workforce & Patient-Flow**" — an agentic AI application that
helps a hospital unit anticipate and manage staffing coverage and patient flow one
shift ahead. It runs on NYC H+H's existing **Red Hat OpenShift AI (RHOAI) platform on
AWS (ROSA)** — the AI demo consumes the platform; it doesn't replace it.

Three user roles, each with a tailored experience:
- **Scheduler / Coordinator** — coverage, no-show risk, smart fills
- **HR / Operations** — overtime, PTO approvals, compliance
- **Provider** — own schedule, request time off

Capabilities demonstrated (all on synthetic data — fictional names, synthetic MRNs,
reserved 555-01xx phone numbers, no PHI):
1. **Predictive analytics** — a **no-show risk model** (per-appointment red/amber/green)
   and a **coverage-forecast model**, both trained and served as real models on
   **KServe** (Red Hat OpenShift AI). Risk and gaps surface on live dashboards.
2. **Agentic scheduling** — guided **book / modify / cancel** flows with a drill-down:
   pick specialty → see doctors (with next availability) → open the doctor's calendar
   (open/booked/PTO-blocked slots) → assign a patient. Cancelling re-offers the freed
   slot to a higher-risk patient.
3. **PTO impact engine** — put a provider on PTO and instantly see which appointments
   are impacted, with **same-specialty / same-time reassignment** options (or
   reschedule, or flag-for-manual), and a one-click "apply all auto."
4. **Conversational AI assistant** — a chat assistant (an LLM agent) that performs
   ALL of the above **through natural language** ("Put Dr. Tanaka on PTO June 16–20
   and show the impact," "Cancel Anthony Russo's appointment," "How is everything?").
   Crucially, the chat and the UI **call the same action layer** — one source of
   truth — so a chat action updates the dashboards instantly.
5. **Dashboards** — coverage, open shifts, predicted no-shows, overtime, bed
   occupancy, predicted admits, plus charts.

### The technology underneath (this is the differentiator — emphasize it)

- **Red Hat OpenShift AI / KServe** serving the models, including a **GPU-served LLM**
  (open-weights **Granite**, IBM/Red Hat) on an NVIDIA A10G — running **on-prem-style
  in the hospital's own AWS VPC**, not a third-party API.
- **LangChain agent** with a tool layer (query data, call the prediction models,
  propose schedule changes); the model does **function-calling** to take real actions.
- **Model routing via an AI gateway** for observability, cost tracking, and fallback.
- **Aurora PostgreSQL + pgvector** for operational data and retrieval-augmented
  grounding; **MLflow** for model tracking; **Grafana/Prometheus** for observability.
- **GitOps + Terraform**: the whole demo deploys onto the platform as a scoped,
  self-contained unit and tears down cleanly — repeatable, governed, auditable.
- **Guardrails built in**: every consequential action (a schedule write) **requires
  human approval**; all data is synthetic and labeled; every screen carries the demo
  banner; the model can fall back to a rules engine if an endpoint is down.

### Narrative arc for the deck (adapt as needed)

1. **Title** — NYC Health + Hospitals · Predictive Workforce & Patient-Flow · an
   agentic-AI demonstration on Red Hat OpenShift AI (AWS).
2. **The challenge** — staffing coverage, overtime, no-shows, and patient flow are
   daily, high-stakes balancing acts across a large public health system; today they're
   reactive and manual. (Frame the pain; mark any figures as illustrative.)
3. **What we built (in one slide)** — the predictive, agentic workforce copilot; the
   "one shift ahead" idea.
4. **A day in the life** — the 5-beat live flow: open on the dashboard → an alert fires
   that next Tuesday is understaffed → ask the assistant "why?" → it surfaces a
   high-no-show cluster + proposes reminders and a smart fill → approve a PTO request
   after seeing the AI-computed coverage impact.
5. **Capability — predictive analytics** (no-show + coverage models on KServe).
6. **Capability — agentic scheduling & PTO impact** (the drill-down + reassignment).
7. **Capability — do it all in chat** (the assistant + "one source of truth").
8. **Architecture** — a clean diagram: the demo app on top of the existing RHOAI/AWS
   platform (KServe/Granite GPU, agent, gateway, Aurora/pgvector, Grafana, GitOps).
9. **Trust, safety & governance** — human-in-the-loop, synthetic data, observability,
   self-hostable open models (data stays in the hospital's cloud), auditability.
10. **What's real today vs. what changes for production** — be candid: this is a demo
    on synthetic data; production needs HIPAA controls, BAAs (or fully in-VPC models),
    de-identification, validated models with bias/fairness review, and EHR/FHIR
    integration.
11. **The future of AI in the hospital** — a credible roadmap: real-time EHR/FHIR
    integration; multi-agent workflows (scheduling, prior-auth, discharge, capacity);
    bias & drift monitoring (TrustyAI); fine-tuned/clinical models served on the same
    platform; ambient + voice; expansion from one unit to the whole system.
12. **Why this approach wins** — build on a governed, open platform you control
    (RHOAI/AWS), reusable across use cases, no vendor lock-in, data sovereignty.
13. **Roadmap / phased plan** — pilot → validate → integrate → scale (rough phases,
    label timelines as indicative).
14. **Call to action / next steps** — what a real pilot would look like and the ask.

Add an appendix slide listing the tech stack and 4–6 likely leadership Q&A
(privacy/PHI, accuracy/hallucination, cost, time-to-production, BAA, integration).

Before generating, if anything material is ambiguous, ask me **at most two**
clarifying questions; otherwise proceed with strong defaults.

## PROMPT END
