#!/usr/bin/env python3
"""
Generate two DEMO PDF reports (FY2024 + FY2025) for Amboy Bank — rich, structured,
and synthetic — so that when uploaded they produce eye-catching indexed output:

  * Financial Highlights table with the SAME metric labels both years (so
    /compare_docs extracts a full set of comparable KPIs → tiles + movers chart).
  * Stated risk observations (→ the observations panel).
  * Narrative prose (→ grounded chat answers with citations).
  * A loan appendix + relationship notes packed with SYNTHETIC PII in safe fiction
    ranges (→ a large "NPI entities tokenized" de-identification count).

2025 shows a believable improvement over 2024. All PII is synthetic (never-issued
SSN areas 900-999, reserved 555-0100..0199 phones). Seeded for reproducibility.

Usage:  python amboy/demo-reports/make_pdfs.py
Output: amboy/demo-reports/Amboy_FY2024.pdf , Amboy_FY2025.pdf
"""
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import generate as G  # reuse safe synthetic-PII formatters + name lists

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

OUT = os.path.dirname(__file__)
SEED = 20240620
NAVY = colors.HexColor("#1E2761")
INK = colors.HexColor("#14193D")
TEAL = colors.HexColor("#0E7C86")
RED = colors.HexColor("#C0392B")
GOLD = colors.HexColor("#C8A24B")
PAPER = colors.HexColor("#F7F8FB")
LINE = colors.HexColor("#E2E8F0")

# Same labels both years; 2025 improved. (Mirrors the seeded Amboy story.)
HIGHLIGHTS = {
    2024: [("Total assets", "$1,482.0M"), ("Total loans", "$1,046.5M"),
           ("Total deposits", "$1,201.3M"), ("Net income", "$14.28M"),
           ("Tier 1 capital ratio", "11.4%"), ("NPA ratio", "1.62%"),
           ("Net charge-off rate", "0.48%"), ("ACL coverage ratio", "312%"),
           ("CRE concentration", "40%"), ("Top-5 issuer concentration", "63%")],
    2025: [("Total assets", "$1,553.9M"), ("Total loans", "$1,092.7M"),
           ("Total deposits", "$1,268.4M"), ("Net income", "$16.91M"),
           ("Tier 1 capital ratio", "12.1%"), ("NPA ratio", "1.18%"),
           ("Net charge-off rate", "0.31%"), ("ACL coverage ratio", "359%"),
           ("CRE concentration", "39%"), ("Top-5 issuer concentration", "61%")],
}

SUMMARY = {
    2024: ("In fiscal year 2024 Amboy Bank grew total assets to $1,482.0M while "
           "maintaining a Tier 1 capital ratio of 11.4%. Asset quality was stable but "
           "elevated: the non-performing asset (NPA) ratio stood at 1.62% and the net "
           "charge-off rate at 0.48%. Allowance for credit losses (ACL) coverage was "
           "312%. Commercial real estate (CRE) concentration reached 40% of the loan "
           "book — above the 35% internal policy limit — and the top-5 issuers made up "
           "63% of the securities portfolio. Net income for the year was $14.28M."),
    2025: ("Fiscal year 2025 showed a clear improvement in credit quality. The NPA "
           "ratio fell to 1.18% (from 1.62%) and the net charge-off rate dropped to "
           "0.31% (from 0.48%), while ACL coverage strengthened to 359%. Capital "
           "improved, with the Tier 1 ratio rising to 12.1%. Total assets grew to "
           "$1,553.9M and net income increased to $16.91M. CRE concentration eased "
           "slightly to 39% but remains above the 35% policy limit, and top-5 issuer "
           "concentration was 61% — both remain watch items."),
}

OBSERVATIONS = {
    2024: [("high", "CRE concentration of 40% exceeds the 35% internal policy limit."),
           ("medium", "Top-5 issuer concentration of 63% of the securities book is elevated."),
           ("medium", "Net charge-off rate of 0.48% is approaching the 0.50% tolerance."),
           ("low", "Tier 1 capital ratio of 11.4% is above the 10.0% internal floor.")],
    2025: [("high", "CRE concentration of 39% still exceeds the 35% internal policy limit."),
           ("medium", "Top-5 issuer concentration of 61% of the securities book remains elevated."),
           ("low", "NPA ratio improved to 1.18% and net charge-offs fell to 0.31% — no action."),
           ("low", "Tier 1 capital ratio strengthened to 12.1%, well above the 10.0% floor.")],
}

SCENARIO = ("Rate-shock sensitivity (illustrative, not a forecast): under a parallel "
            "+200 bps shock, first-order earnings-at-risk is estimated using the one-year "
            "repricing gap; management views the exposure as manageable within current limits.")


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("AmboyTitle", parent=ss["Title"], textColor=NAVY, fontSize=26, spaceAfter=2))
    ss.add(ParagraphStyle("AmboySub", parent=ss["Normal"], textColor=colors.HexColor("#5A6B86"), fontSize=11, alignment=TA_CENTER))
    ss.add(ParagraphStyle("H", parent=ss["Heading2"], textColor=NAVY, fontSize=14, spaceBefore=14, spaceAfter=6))
    ss.add(ParagraphStyle("Body", parent=ss["Normal"], textColor=INK, fontSize=10.5, leading=15))
    ss.add(ParagraphStyle("Note", parent=ss["Normal"], textColor=colors.HexColor("#5A6B86"), fontSize=9))
    ss.add(ParagraphStyle("Cell", parent=ss["Normal"], fontSize=9, leading=12))
    return ss


def _loan_rows(rng, year, n=10):
    rows = [["Loan ID", "Borrower", "SSN", "Phone", "Sector", "Balance", "Status"]]
    loans = []
    statuses = ["Current"] * 6 + ["30-59 DPD", "Nonaccrual", "Charged-Off", "Current"]
    for i in range(1, n + 1):
        first, last = rng.choice(G.FIRST_NAMES), rng.choice(G.LAST_NAMES)
        ssn, phone, addr = G._fmt_ssn(rng), G._fmt_phone(rng), G._fmt_address(rng)
        bal = rng.randint(120_000, 8_500_000)
        st = rng.choice(statuses if year == 2024 else ["Current"] * 8 + ["30-59 DPD", "Nonaccrual"])
        loans.append({"name": f"{first} {last}", "ssn": ssn, "phone": phone, "addr": addr})
        rows.append([f"AMB-{year}-{i:04d}", f"{first} {last}", ssn, phone,
                     rng.choice(G.SECTORS), f"${bal:,}", st])
    return rows, loans


def _notes(rng, loans):
    out = []
    for ln in loans[:6]:
        last4 = G.pp.SSN_RE.search(ln["ssn"]).group(3)
        out.append(rng.choice([
            f"Borrower {ln['name']} (SSN ending {last4}) reached at {ln['phone']}; "
            f"collateral inspected at {ln['addr']}.",
            f"Annual review for {ln['name']}: mailing address {ln['addr']}; "
            f"updated phone {ln['phone']}; SSN last 4 {last4}.",
        ]))
    return out


def build(year, rng):
    ss = _styles()
    path = os.path.join(OUT, f"Amboy_FY{year}.pdf")
    doc = SimpleDocTemplate(path, pagesize=LETTER, title=f"Amboy Bank — FY{year} Report",
                            topMargin=0.7 * inch, bottomMargin=0.7 * inch)
    e = []
    e.append(Paragraph("AMBOY BANK", ss["AmboyTitle"]))
    e.append(Paragraph(f"Annual Investment &amp; Credit Report — Fiscal Year {year}", ss["AmboySub"]))
    e.append(Paragraph("Prepared for the Board Investment &amp; Credit Risk Committee · "
                       "CONFIDENTIAL — synthetic data for demonstration", ss["Note"]))
    e.append(Spacer(1, 16))

    e.append(Paragraph("Executive Summary", ss["H"]))
    e.append(Paragraph(SUMMARY[year], ss["Body"]))

    e.append(Paragraph("Financial Highlights", ss["H"]))
    data = [["Metric", f"FY{year}"]] + [[m, v] for m, v in HIGHLIGHTS[year]]
    t = Table(data, colWidths=[3.4 * inch, 2.2 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("FONTNAME", (1, 1), (1, -1), "Courier-Bold"), ("TEXTCOLOR", (1, 1), (1, -1), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PAPER]),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE), ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    e.append(t)

    e.append(Paragraph("Credit Quality &amp; Risk Observations", ss["H"]))
    for sev, text in OBSERVATIONS[year]:
        dot = {"high": RED, "medium": GOLD, "low": TEAL}[sev]
        e.append(Paragraph(f'<font color="#{dot.hexval()[2:]}">&#9679;</font> '
                           f'<b>[{sev.upper()}]</b> {text}', ss["Body"]))
    e.append(Spacer(1, 6))
    e.append(Paragraph(SCENARIO, ss["Note"]))

    e.append(Paragraph("Loan Appendix (synthetic borrowers)", ss["H"]))
    rows, loans = _loan_rows(rng, year)
    rows = [[Paragraph(str(c), ss["Cell"]) for c in r] for r in rows]
    lt = Table(rows, colWidths=[0.95 * inch, 1.25 * inch, 0.95 * inch, 1.1 * inch, 1.35 * inch, 0.95 * inch, 0.9 * inch])
    lt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PAPER]),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    e.append(lt)

    e.append(Paragraph("Relationship Notes", ss["H"]))
    for note in _notes(rng, loans):
        e.append(Paragraph("• " + note, ss["Body"]))

    e.append(Spacer(1, 12))
    e.append(Paragraph("AI-safe demonstration · all NPI is synthetic · AI solution by IIS — iistech.com", ss["Note"]))
    doc.build(e)
    return path


def main():
    rng = random.Random(SEED)
    for year in (2024, 2025):
        p = build(year, rng)
        print(f"  ✔ wrote {p}")
    print("Done — upload Amboy_FY2024.pdf then Amboy_FY2025.pdf as Report A / B.")


if __name__ == "__main__":
    main()
