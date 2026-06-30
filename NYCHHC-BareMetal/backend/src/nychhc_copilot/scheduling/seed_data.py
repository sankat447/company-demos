"""Deterministic synthetic data generator for the OBGYN demo (seed = 42).

Patterns sourced directly from the NYC H+H AI Scheduling Design Brief (Selamawit
transcript, June 2026): Tuesday-PM cancellations, Monday-AM busiest/lowest-cancel,
visit-type no-show rates, 12 named providers, the 15 scripted demo patients (Daniel
Brooks is the first red flag), and the Brooks/Wu High-Risk PTO conflict.

Pure stdlib (no faker/pandas) so it runs in the backend image with no extra deps,
and produces identical output every run. Single source of truth for BOTH the live
seed (sched_* + workforce.* tables) and the model training corpus.
FOR DEMONSTRATION ONLY — SYNTHETIC DATA. No PHI.
"""

from __future__ import annotations

import random
from datetime import date, timedelta

SEED = 42
TODAY = "2026-06-09"  # Tuesday — anchors the demo week

# ── feature encodings (the TRAINING/SERVING CONTRACT — keep in sync everywhere) ──
APPT_TYPES = {
    "New OB":      {"duration": 40, "base": 0.28},
    "Follow-up":   {"duration": 20, "base": 0.12},
    "High Risk":   {"duration": 45, "base": 0.08},
    "GYN Consult": {"duration": 30, "base": 0.18},
    "Walk-in":     {"duration": 20, "base": 0.45},
}
APPT_TYPE_ORD = {t: i for i, t in enumerate(APPT_TYPES)}
PROVIDER_TYPE_ORD = {"MD": 0, "Midwife": 1, "PA": 2, "Walk-in": 3}
TOD_ORD = {"AM": 0, "PM": 1}
DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# Day/time no-show multipliers — transcript (Tue PM spike, Mon AM lowest).
DAY_TIME_MULT = {
    ("Monday", "AM"): 0.70, ("Monday", "PM"): 0.85,
    ("Tuesday", "AM"): 1.10, ("Tuesday", "PM"): 1.80,
    ("Wednesday", "AM"): 0.90, ("Wednesday", "PM"): 1.00,
    ("Thursday", "AM"): 0.95, ("Thursday", "PM"): 1.05,
    ("Friday", "AM"): 1.10, ("Friday", "PM"): 1.30,
}

# ── 12 named providers (brief §8) ────────────────────────────────────────────
# (id, name, credential, specialty, provider_type, phone, room, work_start, work_end, slot_min)
_PROV = [
    ("p1",  "Dr. Sarah Chen",   "MD",      "Obstetrics",              "MD",      "(212) 555-0101", "L&D-1",    "08:00", "17:00", 20),
    ("p2",  "Dr. Raj Patel",    "MD",      "Gynecology",              "MD",      "(212) 555-0102", "GYN-1",    "09:00", "17:00", 30),
    ("p3",  "Dr. Maria Santos", "MD",      "Obstetrics",              "MD",      "(212) 555-0103", "L&D-2",    "08:00", "16:00", 20),
    ("p4",  "Dr. Omar Hassan",  "MD",      "Gynecology",              "MD",      "(646) 555-0104", "GYN-2",    "09:00", "17:00", 30),
    ("p5",  "Emily Walsh",      "CNM",     "Midwifery",               "Midwife", "(212) 555-0105", "Clinic-1", "09:00", "17:00", 30),
    ("p6",  "Dana Kim",         "CNM",     "Midwifery",               "Midwife", "(646) 555-0106", "Clinic-2", "09:00", "17:00", 30),
    ("p7",  "James Rivera",     "PA",      "Gynecology",              "PA",      "(347) 555-0107", "GYN-3",    "08:00", "16:00", 30),
    ("p8",  "Priya Nair",       "PA",      "Obstetrics",              "PA",      "(212) 555-0108", "Clinic-3", "09:00", "17:00", 20),
    ("p9",  "Dr. Tanya Brooks", "MD",      "Maternal-Fetal Medicine", "MD",      "(718) 555-0109", "MFM-1",    "09:00", "16:00", 45),
    ("p10", "Dr. Alan Wu",      "MD",      "Maternal-Fetal Medicine", "MD",      "(212) 555-0110", "MFM-2",    "09:00", "16:00", 45),
    ("p11", "Chris Moore",      "Walk-in", "Gynecology",              "Walk-in", "(646) 555-0111", "WalkIn-G", "09:00", "17:00", 20),
    ("p12", "Sarah Okafor",     "Walk-in", "Obstetrics",              "Walk-in", "(212) 555-0112", "WalkIn-O", "09:00", "17:00", 20),
]

# Service-line coverage minimums (UC2/UC4, BR-4). High-Risk Panel = Brooks + Wu.
COVERAGE_MINIMUMS = {"Inpatient OB": 2, "Inpatient GYN": 1, "High-Risk Panel": 1, "Outpatient": 1}
SERVICE_LINE = {
    "Obstetrics": "Inpatient OB", "Midwifery": "Inpatient OB",
    "Gynecology": "Inpatient GYN", "Maternal-Fetal Medicine": "High-Risk Panel",
}

# ── 15 scripted demo patients (brief §8 demo_patients.json) ──────────────────
# (id, name, prob, prior_noshows, has_contact, appt_type, day, tod, provider, factors[])
_DEMO = [
    # RED (4)
    ("PT0042", "Daniel Brooks",   0.87, 5, False, "New OB",      "Tuesday",  "PM", "p1",  ["5 prior no-shows", "No text on file", "New OB · Tue PM"]),
    ("PT0117", "Gloria Martinez", 0.74, 3, True,  "Follow-up",   "Tuesday",  "PM", "p8",  ["3 prior no-shows", "Tue PM high-cancel slot"]),
    ("PT0203", "Tanya Williams",  0.68, 4, True,  "GYN Consult", "Tuesday",  "PM", "p2",  ["4 prior no-shows", "Always cancels same week"]),
    ("PT0389", "Lisa Chang",      0.67, 2, False, "New OB",      "Friday",   "PM", "p3",  ["No contact on file", "First OB visit", "Fri PM"]),
    # AMBER (5)
    ("PT0055", "Maria Reyes",     0.48, 1, True,  "High Risk",   "Wednesday","AM", "p9",  ["1 prior no-show", "High-risk panel"]),
    ("PT0198", "Jennifer Park",   0.42, 1, True,  "Follow-up",   "Monday",   "PM", "p4",  ["1 prior no-show", "Booked 6 weeks out"]),
    ("PT0271", "Aisha Johnson",   0.38, 0, True,  "New OB",      "Tuesday",  "AM", "p1",  ["First visit", "Tue AM elevated"]),
    ("PT0440", "Sofia Torres",    0.36, 1, True,  "GYN Consult", "Thursday", "PM", "p7",  ["Self-referred", "Insurance pending"]),
    ("PT0512", "Rachel Kim",      0.35, 0, False, "Follow-up",   "Friday",   "AM", "p6",  ["No contact on file"]),
    # GREEN (6)
    ("PT0021", "Claire Novak",    0.09, 0, True,  "High Risk",   "Monday",   "AM", "p10", ["Engaged patient", "Never missed"]),
    ("PT0088", "Dana Pierce",     0.11, 0, True,  "Follow-up",   "Wednesday","AM", "p5",  ["Confirmed via portal"]),
    ("PT0134", "Mei Lin",         0.08, 0, True,  "New OB",      "Monday",   "AM", "p3",  ["Monday AM — lowest-risk slot"]),
    ("PT0267", "Yara Hassan",     0.13, 0, True,  "Follow-up",   "Thursday", "AM", "p8",  ["Consistent attender"]),
    ("PT0398", "Fatima Diallo",   0.10, 0, True,  "GYN Consult", "Wednesday","PM", "p2",  ["Referred by PCP", "Confirmed"]),
    ("PT0501", "Emma Walsh",      0.07, 0, True,  "High Risk",   "Tuesday",  "AM", "p9",  ["High-risk panel — fully engaged"]),
]

# Filler patient names (deterministic pool for the rest of the schedule).
_FILL_NAMES = [
    "Olivia Bennett", "Nadia Hussain", "Carmen Ortiz", "Sandra Okeke", "Grace Abara",
    "Mei-Ling Chen", "Rosa Gutierrez", "Aaliyah Johnson", "Hannah Goldberg", "Fatou Diallo",
    "Priscilla Adeyemi", "Latoya Williams", "Wei Zhang", "Isabella Romano", "Robert? no",
    "Amara Eze", "Sofia Costa", "Nina Petrova", "Leah Cohen", "Bianca Lopez",
    "Hana Suzuki", "Zara Khan", "Ivy Tran", "Maya Singh", "Elena Rossi",
]
_COLORS = ["#3a0b5e", "#6a1f9e", "#0f9e8e", "#b8730a", "#c62828", "#564f6b"]


def _next_dow(weekday_name: str, on_or_after: str = TODAY) -> str:
    start = date.fromisoformat(on_or_after)
    target = DOW.index(weekday_name)
    delta = (target - start.weekday()) % 7
    return (start + timedelta(days=delta)).isoformat()


def _tier(prob: float) -> str:
    return "RED" if prob > 0.65 else "AMBER" if prob >= 0.35 else "GREEN"


def _initials(name: str) -> str:
    parts = [p for p in name.replace(",", "").split() if p and not p.endswith(".")]
    return (parts[0][0] + parts[-1][0]).upper() if len(parts) >= 2 else name[:2].upper()


# ── public builders ──────────────────────────────────────────────────────────
def providers() -> list[tuple]:
    """sched_providers rows: id,name,credential,specialty,phone,room,work_start,
    work_end,slot_min,weekly_hours,ot_hours,provider_type."""
    out = []
    for (pid, name, cred, spec, ptype, phone, room, ws, we, slot) in _PROV:
        out.append((pid, name, cred, spec, phone, room, ws, we, slot, 40.0, 0.0, ptype))
    return out


def _all_patients() -> list[dict]:
    rng = random.Random(SEED)
    pats = []
    for (pid, name, prob, prior, contact, atype, day, tod, prov, factors) in _DEMO:
        pats.append({"id": pid, "name": name, "mrn": "SYN-" + pid[2:],
                     "phone": f"(212) 555-0{rng.randint(100, 199)}",
                     "dob": "1990-01-01", "risk_tier": _tier(prob),
                     "prior_noshows": prior, "has_contact": contact,
                     "visit_count": rng.randint(1, 20),
                     "contact_pref": "SMS" if contact else "None"})
    for i, name in enumerate([n for n in _FILL_NAMES if "?" not in n]):
        prior = rng.choice([0, 0, 0, 1, 1, 2])
        pats.append({"id": f"PT1{i:03d}", "name": name, "mrn": f"SYN-1{i:03d}",
                     "phone": f"(646) 555-0{rng.randint(100, 199)}",
                     "dob": "1990-01-01",
                     "risk_tier": "High" if prior >= 2 else "Medium" if prior else "Low",
                     "prior_noshows": prior, "has_contact": rng.random() > 0.15,
                     "visit_count": rng.randint(1, 24),
                     "contact_pref": rng.choice(["SMS", "Call", "Email", "None"])})
    return pats


def patients() -> list[tuple]:
    """sched_patients rows: id,name,mrn,phone,dob,risk_tier,prior_noshows,has_contact,
    visit_count,contact_pref."""
    return [(p["id"], p["name"], p["mrn"], p["phone"], p["dob"], p["risk_tier"],
             p["prior_noshows"], 1 if p["has_contact"] else 0, p["visit_count"], p["contact_pref"])
            for p in _all_patients()]


def appointments() -> list[tuple]:
    """Upcoming schedule across the demo window: the 15 scripted demo appts + filler.
    sched_appointments rows: id,patient_id,provider_id,date,time,duration_min,type,reason,status."""
    rng = random.Random(SEED + 1)
    appts = []
    prov_spec = {p[0]: p[3] for p in _PROV}
    prov_type = {p[0]: p[4] for p in _PROV}
    # 1) scripted demo appts (fixed times so the panel + calendar line up)
    am_pm_time = {"AM": "09:00", "PM": "14:00"}
    demo_clock = {  # spread the scripted patients so they don't all collide
        "PT0042": ("Tuesday", "14:20"), "PT0117": ("Tuesday", "15:00"), "PT0203": ("Tuesday", "14:40"),
        "PT0389": ("Friday", "14:00"), "PT0055": ("Wednesday", "09:20"), "PT0198": ("Monday", "14:00"),
        "PT0271": ("Tuesday", "09:00"), "PT0440": ("Thursday", "15:30"), "PT0512": ("Friday", "08:40"),
        "PT0021": ("Monday", "09:00"), "PT0088": ("Wednesday", "09:40"), "PT0134": ("Monday", "08:40"),
        "PT0267": ("Thursday", "09:20"), "PT0398": ("Wednesday", "14:00"), "PT0501": ("Tuesday", "09:40"),
    }
    n = 0
    for (pid, name, prob, prior, contact, atype, day, tod, prov, factors) in _DEMO:
        d = _next_dow(day)
        _, clock = demo_clock[pid]
        dur = APPT_TYPES[atype]["duration"]
        n += 1
        appts.append((f"a{n}", pid, prov, d, clock, dur, atype, f"{atype} visit", "Booked"))
    # 2) filler appts to populate calendars over the next 2 weeks (patterns by day count)
    fill_ids = [p["id"] for p in _all_patients() if p["id"].startswith("PT1")]
    day_counts = {"Monday": 5, "Tuesday": 6, "Wednesday": 5, "Thursday": 4, "Friday": 4}
    start = date.fromisoformat(TODAY)
    for off in range(0, 14):
        d = start + timedelta(days=off)
        dname = DOW[d.weekday()]
        if dname not in day_counts:
            continue
        provs = rng.sample([p[0] for p in _PROV], day_counts[dname])
        for prov in provs:
            spec = prov_spec[prov]
            for slot_clock in ("10:00", "11:00", "13:00", "15:00"):
                if rng.random() > 0.55:
                    continue
                atype = ("Walk-in" if prov_type[prov] == "Walk-in"
                         else "High Risk" if spec == "Maternal-Fetal Medicine"
                         else "GYN Consult" if spec == "Gynecology" and rng.random() < 0.5
                         else rng.choice(["New OB", "Follow-up"]) if spec == "Obstetrics"
                         else "Follow-up")
                pid = rng.choice(fill_ids)
                n += 1
                appts.append((f"a{n}", pid, prov, d.isoformat(), slot_clock,
                              APPT_TYPES[atype]["duration"], atype, f"{atype} visit", "Booked"))
    return appts


def pto_blocks() -> list[tuple]:
    """sched_pto rows: id,provider_id,start,end,type,status. The Brooks/Wu overlap
    (High-Risk Panel) is the scripted UC4 conflict."""
    return [
        ("pto1", "p2",  "2026-06-26", "2026-07-10", "PTO",      "Approved"),
        ("pto2", "p9",  "2026-07-14", "2026-07-18", "CME",      "Pending"),   # Brooks
        ("pto3", "p10", "2026-07-07", "2026-07-21", "PTO",      "Pending"),   # Wu — overlaps Brooks → conflict
        ("pto5", "p1",  "2026-09-01", "2026-09-12", "PTO",      "Pending"),
    ]


def risk_panel() -> list[tuple]:
    """workforce.risk_today rows: tier,patient_name,syn_id,mrn,phone,appt_time,provider,
    risk_pct,factors(json text),action — the 15 scripted demo patients (Daniel Brooks first)."""
    import json
    prov_name = {p[0]: p[1].split()[-1] for p in _PROV}
    rows = []
    for i, (pid, name, prob, prior, contact, atype, day, tod, prov, factors) in enumerate(_DEMO, 1):
        tier = _tier(prob)
        action = ("Call + standby" if tier == "RED" else
                  "Send text reminder" if tier == "AMBER" else "No action")
        clock = {"AM": "9:00 AM", "PM": "2:00 PM"}[tod]
        disp = prov_name.get(prov, prov)
        rows.append((tier, name, f"#{i} · {pid}", f"SYN-{pid[2:]}",
                     f"(212) 555-0{100 + i}", clock, f"Dr. {disp}" if not disp[0].islower() else disp,
                     round(prob * 100), json.dumps(factors), action))
    return rows


def pto_queue() -> list[tuple]:
    """workforce.pto_queue rows: ini,color,provider_name,type,dates,coverage_gap,status."""
    name = {p[0]: p[1] for p in _PROV}
    return [
        (_initials(name["p2"]),  _COLORS[0], name["p2"],  "PTO",            "Jun 26 – Jul 10", 0, "ok"),
        (_initials(name["p9"]),  _COLORS[1], name["p9"],  "CME / Education", "Jul 14 – Jul 18", 1, "pend"),
        (_initials(name["p10"]), _COLORS[2], name["p10"], "PTO",            "Jul 7 – Jul 21",  1, "pend"),
        (_initials(name["p1"]),  _COLORS[3], name["p1"],  "PTO",            "Sep 1 – Sep 12",  0, "pend"),
        (_initials(name["p5"]),  _COLORS[4], name["p5"],  "PTO",            "Aug 4 – Aug 8",   0, "ok"),
    ]


def roster() -> list[tuple]:
    """workforce.roster rows: ini,color,name,role,license,phone,shift,weekly_hours,status,
    pto_balance_pct,pto_balance_hours."""
    rng = random.Random(SEED + 2)
    out = []
    for i, (pid, name, cred, spec, ptype, phone, room, ws, we, slot) in enumerate(_PROV):
        role = f"{spec} · {cred}"
        lic = f"NY-{cred[:3].upper()}-{rng.randint(100000, 999999)}"
        pct = rng.choice([78, 54, 66, 31, 48, None, None, 62, None, 40])
        out.append((_initials(name), _COLORS[i % len(_COLORS)], name, role, lic, phone,
                    "Days", 40.0, "On shift" if i % 4 else "Available",
                    pct, pct * 2 if pct else None))
    return out


def history(n_rows: int = 2400):
    """Historical appointment corpus (~18 months) for model training + analytics.
    Returns list of dicts with the brief's features + actual_noshow outcome."""
    rng = random.Random(SEED + 3)
    pats = _all_patients()
    rows = []
    start = date(2025, 1, 1)
    cur = start
    while len(rows) < n_rows:
        dname = DOW[cur.weekday()]
        if dname in ("Saturday", "Sunday"):
            cur += timedelta(days=1)
            continue
        n_prov = {"Tuesday": 6, "Monday": 5, "Wednesday": 5}.get(dname, 4)
        for prov in rng.sample(_PROV, n_prov):
            (pid_p, pname, cred, spec, ptype, *_rest) = prov
            for tod in ("AM", "PM"):
                if rng.random() > 0.6:
                    continue
                atype = ("Walk-in" if ptype == "Walk-in"
                         else "High Risk" if spec == "Maternal-Fetal Medicine"
                         else "GYN Consult" if spec == "Gynecology" and rng.random() < 0.5
                         else rng.choice(["New OB", "Follow-up"]) if spec == "Obstetrics"
                         else "Follow-up")
                pt = rng.choice(pats)
                base = APPT_TYPES[atype]["base"]
                mult = DAY_TIME_MULT.get((dname, tod), 1.0)
                if pt["prior_noshows"] >= 3:
                    mult *= 1.60
                elif pt["prior_noshows"] >= 1:
                    mult *= 1.20
                if not pt["has_contact"]:
                    mult *= 1.30
                prob = min(0.92, base * mult)
                rows.append({
                    "date": cur.isoformat(), "day_of_week": dname, "time_of_day": tod,
                    "appt_type": atype, "duration_min": APPT_TYPES[atype]["duration"],
                    "provider_id": pid_p, "provider_type": ptype, "patient_id": pt["id"],
                    "prior_noshows": pt["prior_noshows"], "has_contact": 1 if pt["has_contact"] else 0,
                    "contact_pref": pt["contact_pref"], "visit_count": pt["visit_count"],
                    "noshow_prob": round(prob, 3), "risk_tier": _tier(prob),
                    "actual_noshow": 1 if rng.random() < prob else 0,
                })
                if len(rows) >= n_rows:
                    break
        cur += timedelta(days=1)
    return rows


def encode_features(appt_type: str, day_of_week: str, time_of_day: str,
                    prior_noshows: int, has_contact: int, provider_type: str,
                    visit_count: int) -> list[float]:
    """The no-show model feature vector (training == serving contract)."""
    return [
        float(APPT_TYPE_ORD.get(appt_type, 1)),
        float(DOW.index(day_of_week) if day_of_week in DOW else 0),
        float(TOD_ORD.get(time_of_day, 0)),
        float(prior_noshows or 0),
        float(has_contact or 0),
        float(PROVIDER_TYPE_ORD.get(provider_type, 0)),
        float(visit_count or 0),
    ]
