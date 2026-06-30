#!/usr/bin/env python
"""Generate docs/user-guide.pdf — the OBGYN AI Scheduling Assistant user manual.

Structured with the client's ASK list as REQUIREMENTS (REQ-1..REQ-6): each requirement
states the objective, then the steps (UI + chat) to achieve it, the expected result, and
what runs under the hood. Reproducible — re-run to regenerate:

    backend/.venv/bin/python docs/build_user_guide.py

FOR DEMONSTRATION ONLY — SYNTHETIC DATA. No PHI.
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable, ListFlowable, ListItem, PageBreak, Paragraph, SimpleDocTemplate,
    Spacer, Table, TableStyle,
)

OUT = Path(__file__).parent / "user-guide.pdf"
UI_URL = "https://nychhc-frontend-iis-ai-ui.apps.ocp419.crucible.iisl.com"

CLAY = colors.HexColor("#b8552e")
CLAY_DEEP = colors.HexColor("#8f4022")
INK = colors.HexColor("#2b2b2b")
INK3 = colors.HexColor("#6b6b6b")
TINT = colors.HexColor("#f6ece6")
LINE = colors.HexColor("#e3d6cd")

ss = getSampleStyleSheet()


def style(name, **kw):
    base = kw.pop("parent", ss["Normal"])
    return ParagraphStyle(name, parent=base, **kw)


H_TITLE = style("t", fontName="Helvetica-Bold", fontSize=22, textColor=CLAY_DEEP, leading=26, spaceAfter=6)
H_SUB = style("st", fontName="Helvetica", fontSize=12, textColor=INK3, leading=16, spaceAfter=2)
H1 = style("h1", fontName="Helvetica-Bold", fontSize=15, textColor=CLAY_DEEP, leading=19, spaceBefore=14, spaceAfter=6)
H2 = style("h2", fontName="Helvetica-Bold", fontSize=11.5, textColor=INK, leading=15, spaceBefore=8, spaceAfter=3)
BODY = style("b", fontName="Helvetica", fontSize=10, textColor=INK, leading=14.5, spaceAfter=5, alignment=TA_LEFT)
SMALL = style("sm", fontName="Helvetica", fontSize=9, textColor=INK3, leading=12.5)
LBL = style("lbl", fontName="Helvetica-Bold", fontSize=9, textColor=CLAY_DEEP, leading=12)
STEP = style("step", fontName="Helvetica", fontSize=10, textColor=INK, leading=14, spaceAfter=2)
PROMPT = style("p", fontName="Courier", fontSize=9, textColor=CLAY_DEEP, leading=13, leftIndent=6,
               backColor=TINT, borderPadding=4, spaceAfter=3)


def chip(text):
    return Paragraph(f'<font color="#8f4022"><b>{text}</b></font>', SMALL)


def steps(items, numbered=True):
    flow = [ListItem(Paragraph(t, STEP)) for t in items]
    return ListFlowable(flow, bulletType="1" if numbered else "bullet",
                        leftIndent=16, bulletFontName="Helvetica-Bold",
                        bulletColor=CLAY, start="1" if numbered else None,
                        spaceBefore=2, spaceAfter=6)


def prompts(items):
    return [Paragraph(f'&ldquo;{p}&rdquo;', PROMPT) for p in items]


def callout(text, tint=TINT):
    t = Table([[Paragraph(text, SMALL)]], colWidths=[6.6 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), tint),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, CLAY),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def req_header(rid, ask, title, role):
    head = Table(
        [[Paragraph(f'<b>{rid}</b>', style("rh", fontName="Helvetica-Bold", fontSize=12, textColor=colors.white)),
          Paragraph(f'<b>{title}</b>  <font size=8>({ask})</font>',
                    style("rt", fontName="Helvetica-Bold", fontSize=12, textColor=colors.white))]],
        colWidths=[0.85 * inch, 5.75 * inch])
    head.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CLAY_DEEP),
        ("BACKGROUND", (0, 0), (0, 0), CLAY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    return [Spacer(1, 8), head, Spacer(1, 4),
            Paragraph(f'<b>Role:</b> {role}', SMALL), Spacer(1, 4)]


def requirement(story, rid, ask, title, role, objective, ui_steps, chat_prompts, expected, under_hood):
    story += req_header(rid, ask, title, role)
    story.append(Paragraph("Objective", LBL))
    story.append(Paragraph(objective, BODY))
    story.append(Paragraph("How to — in the app", H2))
    story.append(steps(ui_steps))
    if chat_prompts:
        story.append(Paragraph("How to — by chat (Copilot tab)", H2))
        story += prompts(chat_prompts)
        story.append(Spacer(1, 3))
    story.append(Paragraph("Expected result", LBL))
    story.append(Paragraph(expected, BODY))
    story.append(callout(f'<b>Under the hood:</b> {under_hood}'))
    story.append(Spacer(1, 6))


def build():
    doc = SimpleDocTemplate(str(OUT), pagesize=LETTER,
                            leftMargin=0.85 * inch, rightMargin=0.85 * inch,
                            topMargin=0.7 * inch, bottomMargin=0.7 * inch,
                            title="NYC H+H OBGYN AI Scheduling — User Manual (Requirements & How-To)",
                            author="NYC Health + Hospitals demo")
    s = []

    # ── Cover ────────────────────────────────────────────────────────────────
    s.append(Paragraph("NYC Health + Hospitals", H_SUB))
    s.append(Paragraph("OBGYN AI Scheduling Assistant", H_TITLE))
    s.append(Paragraph("User Manual — Requirements &amp; How-To Guide", H_SUB))
    s.append(Spacer(1, 6))
    s.append(HRFlowable(width="100%", thickness=1, color=LINE))
    s.append(Spacer(1, 6))
    s.append(callout(
        "<b>FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA.</b> All names, "
        "phone numbers (555-01xx) and MRNs (SYN-xxxx) are fictional. No PHI is present. The "
        "assistant is decision-support: it recommends, a human decides — nothing auto-executes.",
        tint=colors.HexColor("#fbeee8")))
    s.append(Spacer(1, 8))
    s.append(Paragraph(
        "This manual is organized around the client&rsquo;s <b>ASK list</b>. Each ASK is written as a "
        "<b>requirement</b> (REQ-1 &hellip; REQ-6): the objective, the steps to achieve it (in the app and "
        "by chat), the expected result, and what runs behind the scenes. A final section covers the "
        "human-in-the-loop approval workflow that every change passes through.", BODY))

    s.append(Paragraph("Getting started", H1))
    s.append(steps([
        f'Open the assistant: <font name="Courier" size=9>{UI_URL}</font>',
        "Pick a role in the top-right role switcher. The role sets which tabs and actions you see: "
        "<b>Scheduler</b> (Selamawit — scheduling lead), <b>Approver</b> (Marcus — HR/operations), "
        "<b>Provider</b> (Dr. Chen), <b>Leadership</b> (Dr. Adeyinka — Chair/CCO).",
        "Use the tabs to reach the work: <b>Dashboard</b> (KPIs + proactive insights), "
        "<b>Planning</b> (coverage, capacity, cancellations, template), <b>Approvals</b> (the HITL queue + "
        "audit trail), <b>Reporting</b> (department view, Leadership), and <b>Copilot</b> (chat).",
        "Ask anything in <b>Copilot</b> in plain language — the assistant answers from the live data and "
        "remembers the conversation as you move between tabs.",
    ]))
    s.append(callout("<b>Tip:</b> every requirement below can be driven two ways — through the on-screen "
                     "cards, or by typing the example prompts into the Copilot tab. Both use the same data "
                     "and the same approval gate."))

    s.append(Paragraph("Requirements at a glance", H1))
    tbl = Table([
        [Paragraph("<b>Req</b>", SMALL), Paragraph("<b>Ask</b>", SMALL), Paragraph("<b>What it lets you do</b>", SMALL)],
        [chip("REQ-1"), Paragraph("ASK 1", SMALL), Paragraph("Right-size the template — double-block & walk-in decisions from cancellation type", SMALL)],
        [chip("REQ-2"), Paragraph("ASK 2", SMALL), Paragraph("Approve PTO ahead without creating uncovered service windows", SMALL)],
        [chip("REQ-3"), Paragraph("ASK 3", SMALL), Paragraph("See the department as a whole and find the cycle-time bottleneck", SMALL)],
        [chip("REQ-4"), Paragraph("ASK 4", SMALL), Paragraph("Match providers to minute-weighted demand (headcount &ne; capacity)", SMALL)],
        [chip("REQ-5"), Paragraph("ASK 5", SMALL), Paragraph("Keep PHI in Epic — analyze aggregates, route patient-level work to Epic", SMALL)],
        [chip("REQ-6"), Paragraph("ASK 6", SMALL), Paragraph("Build the department-level value case for leadership", SMALL)],
    ], colWidths=[0.7 * inch, 0.7 * inch, 5.2 * inch])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TINT),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    s.append(tbl)
    s.append(PageBreak())

    # ── REQ-1 (ASK1) ──────────────────────────────────────────────────────────
    requirement(
        s, "REQ-1", "ASK 1", "Appointment template &amp; cancellation strategy", "Scheduler",
        objective=(
            "Decide whether to <b>double-block</b> a slot and whether to add a <b>walk-in provider</b> — "
            "driven by <i>why</i> appointments fall off. Advance cancellations free a slot you can refill; "
            "true no-shows waste it. The two need opposite responses."),
        ui_steps=[
            "Go to the <b>Planning</b> tab.",
            "Read the <b>Cancellations — advance vs true no-show</b> card. Each day/shift splits the cancel "
            "rate into <i>advance</i> (refillable) and <i>true no-show</i> (wasted).",
            "Read the <b>Template recommendation</b> card: it flags &ldquo;Double-block&rdquo; only where true "
            "no-shows are high, and &ldquo;Do NOT double-block&rdquo; where cancels are mostly advance.",
            "Check the walk-in line under Template for the Friday full-day vs half-day scenario and the "
            "projected hours/dollars saved.",
        ],
        chat_prompts=[
            "How do cancellations break down by day this quarter?",
            "Should we double-block Tuesday afternoons?",
            "Do we need a full-day walk-in provider on Fridays?",
        ],
        expected=(
            "Tuesday PM reads <b>advance-heavy</b> &rarr; <i>don&rsquo;t</i> double-block (tighten the waitlist "
            "instead). Monday AM reads <b>true-no-show-heavy</b> &rarr; <i>do</i> double-block. The Friday walk-in "
            "demand is AM-concentrated, so a <b>half-day</b> template covers it and frees ~48 provider-hours / "
            "~$5,280 a quarter with zero patients turned away."),
        under_hood=(
            "Computed from the appointment-history corpus (each appointment tagged attended / advance-cancel / "
            "no-show). Deterministic and grounded — no guesswork."))

    # ── REQ-2 (ASK2) ──────────────────────────────────────────────────────────
    requirement(
        s, "REQ-2", "ASK 2", "Forward PTO coverage (approve-ahead)", "Scheduler / Approver",
        objective=(
            "Approve time off <i>before</i> it creates a problem. Coverage is a <b>skill-mix</b> question, not a "
            "headcount one — the assistant scans the next 90 days and tells you whether a leave request drops a "
            "service line below its minimum, and how to keep it covered."),
        ui_steps=[
            "Open the <b>Planning</b> tab and read the <b>90-day coverage plan</b> card — days below a service-line "
            "minimum are listed with the providers out and the earliest at-risk date.",
            "As <b>Approver</b>, open the <b>PTO</b> tab to see pending requests and their coverage impact.",
            "Decide: approve, stagger the leave, or pull a peer/float onto service. Approving a request that "
            "would leave a window uncovered is <b>blocked</b> until explicitly overridden.",
        ],
        chat_prompts=[
            "Where can't I cover service in the next 90 days?",
            "Can I approve PTO for Dr. Wu July 14 to 18?",
        ],
        expected=(
            "The plan ranks the gaps (e.g. the High-Risk Panel — Brooks + Wu — is the tightest). For a specific "
            "request the assistant answers approvable / not, and if not, offers concrete options (stagger the "
            "dates, add a per-diem). Final sign-off is always yours."),
        under_hood=(
            "Coverage is evaluated against configurable service-line minimums over the roster + PTO calendar; "
            "the approval path is gated so nothing is silently approved into an uncovered window."))

    s.append(PageBreak())

    # ── REQ-3 (ASK3) ──────────────────────────────────────────────────────────
    requirement(
        s, "REQ-3", "ASK 3", "Consolidated department view (cycle time)", "Leadership",
        objective=(
            "See the department <b>as a whole</b> and find where time is actually lost. Cycle time (referral "
            "&rarr; seen) is the sum of hand-offs; the assistant attributes any slip to the specific stage rather "
            "than blaming &lsquo;capacity.&rsquo;"),
        ui_steps=[
            "Switch to the <b>Leadership</b> role.",
            "Open the <b>Reporting</b> tab and read the <b>cycle-time by hand-off</b> view — total days this "
            "period vs the prior quarter, broken into clerical intake, clinical scheduling, and provider "
            "availability.",
        ],
        chat_prompts=[
            "How is the department performing as a whole?",
            "Where's the cycle-time increase coming from?",
        ],
        expected=(
            "Cycle time is up (~6.1 days vs ~5.4 last quarter) and the slip is isolated to the <b>clerical "
            "intake</b> hand-off — not provider capacity. The fix (consolidate intake / add logging capacity) "
            "compresses cycle time more than anything on the provider side."),
        under_hood=(
            "Aggregated from per-referral hand-off timings (recent cohort vs prior); the bottleneck stage is "
            "identified by the largest period-over-period increase."))

    # ── REQ-4 (ASK4) ──────────────────────────────────────────────────────────
    requirement(
        s, "REQ-4", "ASK 4", "Capacity vs headcount (load balancing)", "Scheduler / Approver",
        objective=(
            "Match providers to <b>demand</b>, not to a head-count. A day can look balanced by bodies yet be "
            "over-loaded once you weight by visit-type minutes (a New-OB visit is far longer than a follow-up)."),
        ui_steps=[
            "Open the <b>Planning</b> tab and read the <b>Provider capacity — minute-weighted</b> card: per-weekday "
            "utilization with an over-loaded / under-utilised flag.",
            "Read the one-line rebalance recommendation (e.g. &ldquo;move one provider&rdquo; from the slack day to "
            "the over-loaded day).",
            "Click <b>&ldquo;Draft proposal &rarr;&rdquo;</b> (top-right of the card). The rebalance is staged into the "
            "<b>Approvals</b> queue and you&rsquo;re taken straight there.",
        ],
        chat_prompts=[
            "Is our provider distribution actually matching demand?",
            "Submit it to the approver as a proposal",
        ],
        expected=(
            "Utilization differs by weekday even when head-count looks even; the over-loaded day is flagged with "
            "a cost-neutral rebalance. &ldquo;Draft proposal&rdquo; (or the chat command) places it in the approver "
            "queue for sign-off — it does not change the schedule by itself."),
        under_hood=(
            "Demand per weekday comes from a <b>forecast model served by KServe on OpenShift AI</b> "
            "(<font name='Courier' size=8>nychhc-forecast</font>), divided by staffed minutes; the no-show risk "
            "model is served the same way. If a model is unreachable the view falls back to history and says so."))

    s.append(PageBreak())

    # ── REQ-5 (ASK5) ──────────────────────────────────────────────────────────
    requirement(
        s, "REQ-5", "ASK 5", "Epic as system of record &amp; PHI boundary", "Scheduler / Approver",
        objective=(
            "Keep <b>Epic the single source of truth</b> and keep PHI out of the assistant. It analyzes "
            "de-identified aggregates and sends any patient-level, actionable output back into Epic — so nothing "
            "lives in two places."),
        ui_steps=[
            "Work from the aggregate cards (coverage, capacity, cancellations) as usual — these carry no patient "
            "identifiers.",
            "When you need to act on specific patients, use the assistant to post an aggregate alert to the Epic "
            "scheduling chat; the named work happens in Epic.",
        ],
        chat_prompts=[
            "Which specific patients are affected on Sept 9?",
            "Post a coverage alert to the Epic chat",
            "Where are you getting these numbers?",
        ],
        expected=(
            "A request for a named patient list is <b>declined here and routed to Epic</b> (the assistant keeps it "
            "at the aggregate). Posting an alert writes the date/service/options to the Epic scheduling chat and "
            "is recorded in the audit trail. &ldquo;Where are you getting this?&rdquo; explains that all data is read "
            "from Epic."),
        under_hood=(
            "The assistant reaches data only through an Epic/FHIR adapter seam — it never holds Epic credentials. "
            "Posting an alert is a role-gated, audited action (Scheduler/Approver)."))

    # ── REQ-6 (ASK6) ──────────────────────────────────────────────────────────
    requirement(
        s, "REQ-6", "ASK 6", "Department-level value case", "Scheduler / Leadership",
        objective=(
            "Turn the day-to-day wins into a <b>department-level justification</b> a Chair/CCO will weigh — framed "
            "as a department outcome, not one director&rsquo;s preference."),
        ui_steps=[
            "Gather the supporting numbers from Planning (capacity, cancellations) and Reporting (cycle time).",
            "Ask the assistant to assemble the case; review and edit before sharing.",
        ],
        chat_prompts=[
            "Help me make the case for the chair",
            "Build the one-page business case for OBGYN scheduling",
        ],
        expected=(
            "A short, department-framed summary built from the real metrics: the cost-neutral rebalance, the "
            "half-day Friday walk-in savings, the cycle-time fix at intake — each stated as a department win with "
            "the number behind it."),
        under_hood=(
            "Synthesized from the same grounded analytics used elsewhere; advisory — you confirm before acting "
            "or sharing."))

    s.append(PageBreak())

    # ── Cross-cutting: the approval workflow ─────────────────────────────────
    s.append(Paragraph("The approval workflow (every change passes through here)", H1))
    s.append(Paragraph(
        "Nothing the assistant proposes is applied automatically. Every recommendation becomes a "
        "<b>proposal</b> that a human approves, modifies, or rejects — and every decision is written to an "
        "audit trail with the user and timestamp.", BODY))
    s.append(Paragraph("Walk-through", H2))
    s.append(steps([
        "<b>Draft</b> — from the capacity card click &ldquo;Draft proposal&rarr;&rdquo;, or tell the assistant "
        "&ldquo;submit it as a proposal.&rdquo; It is staged, not applied.",
        "<b>Find it</b> — open the <b>Approvals</b> tab (Scheduler/Approver). The proposal appears in the "
        "pending queue with its summary and rationale.",
        "<b>Decide</b> — <b>Approve</b>, <b>Modify</b>, or <b>Reject</b>. A change that would leave a service "
        "window uncovered is blocked unless explicitly overridden.",
        "<b>Audit</b> — the decision is recorded (who, what, when, outcome) and visible in the audit trail on "
        "the same tab.",
    ]))
    s.append(callout(
        "<b>Why this matters:</b> it is the guardrail behind every ASK — the assistant does the analysis and "
        "drafts the action; a named human always makes the final call, and the record proves it."))

    s.append(Paragraph("Good to know", H1))
    s.append(steps([
        "<b>Synthetic data only.</b> Names, phones (555-01xx) and MRNs (SYN-xxxx) are fictional; no PHI.",
        "<b>AI models run on OpenShift AI / KServe.</b> Two models are served and used: no-show risk and "
        "demand forecast. The conversational assistant uses Claude; the on-screen answers are grounded in the "
        "live data.",
        "<b>Session memory.</b> The Copilot conversation persists as you move between tabs and roles — it does "
        "not reset. Use &ldquo;Clear&rdquo; to start fresh.",
        "<b>Roles gate actions.</b> Providers can view their own schedule but cannot approve or post; "
        "Leadership sees the department reporting view.",
    ], numbered=False))
    s.append(Spacer(1, 8))
    s.append(HRFlowable(width="100%", thickness=0.5, color=LINE))
    s.append(Paragraph(
        "NYC Health + Hospitals — OBGYN AI Scheduling Assistant · demonstration build · synthetic data.", SMALL))

    doc.build(s)
    print(f"wrote {OUT}  ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    build()
