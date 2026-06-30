"""Synthetic seed for the OBGYN scheduling directory. NO PHI.

OBGYN department (revised spec): inpatient 24/7 OB + GYN coverage and an outpatient
9-5 clinic across MDs, CNM midwives, and PAs. Scheduling persona: Selamawit.
Fictional names · phones in the reserved 555-01xx range · MRNs SYN-xxxx.
Anchored to TODAY = 2026-06-09 (Tue) for deterministic demos.

Scripted demo beats:
  - UC4 PTO conflict: Dr. Amara Okonkwo (p1) and Dr. Rachel Stein (p2) — BOTH Obstetrics —
    have OVERLAPPING leave Jun 16-20 / Jun 17-19. Inpatient OB minimum = 2 providers, so the
    overlap leaves an UNCOVERED OB window (Jun 17-19) the impact engine must surface.
  - UC1 no-show: a mix of red/amber/green OBGYN appointments with explanatory factors.
"""

TODAY = "2026-06-09"

# Service-line coverage minimums (UC2/UC4, BR-4): providers required on, per service line.
COVERAGE_MINIMUMS = {
    "Inpatient OB": 2,    # 24/7 — at least two obstetric attendings on service
    "Inpatient GYN": 1,   # 24/7 — at least one gyn provider on service
    "MFM Consult": 1,
    "Outpatient Clinic": 1,
}
# Which specialty staffs which service line (for coverage math). Inpatient OB is
# covered by the obstetric attendings (the conflict math keys off this small team).
SERVICE_LINE = {
    "Obstetrics": "Inpatient OB",
    "Gynecology": "Inpatient GYN",
    "Maternal-Fetal Medicine": "MFM Consult",
    "Midwifery": "Outpatient Clinic",
}

# id, name, credential, specialty, phone, room, work_start, work_end, slot_min, weekly_hours, ot_hours
PROVIDERS = [
    ("p1",  "Dr. Amara Okonkwo",  "MD",  "Obstetrics",                "(212) 555-0142", "L&D-1",   "08:00", "17:00", 20, 40.0, 0.0),
    ("p2",  "Dr. Rachel Stein",   "MD",  "Obstetrics",                "(212) 555-0150", "L&D-2",   "08:00", "16:00", 20, 36.0, 0.0),
    ("p3",  "Dr. Priya Nair",     "MD",  "Gynecology",                "(212) 555-0161", "GYN-3",   "09:00", "17:00", 30, 40.0, 2.0),
    ("p4",  "Dr. David Cohen",    "MD",  "Gynecology",                "(646) 555-0167", "GYN-5",   "09:00", "17:00", 30, 36.0, 0.0),
    ("p5",  "Dr. Sofia Ramirez",  "MD",  "Maternal-Fetal Medicine",   "(718) 555-0172", "MFM-2",   "09:00", "16:00", 30, 32.0, 0.0),
    ("p6",  "Dr. Helen Park",     "MD",  "Maternal-Fetal Medicine",   "(212) 555-0180", "MFM-4",   "09:00", "17:00", 30, 40.0, 0.0),
    ("p7",  "Naomi Bridges",      "CNM", "Midwifery",                 "(212) 555-0156", "Clinic-1","09:00", "17:00", 30, 32.0, 0.0),
    ("p8",  "Grace Adeyemi",      "CNM", "Midwifery",                 "(646) 555-0190", "Clinic-2","09:00", "17:00", 30, 36.0, 0.0),
    ("p9",  "Daniel Osei",        "PA",  "Gynecology",                "(347) 555-0144", "GYN-7",   "08:00", "16:00", 30, 40.0, 0.0),
    ("p10", "Aisha Rahman",       "PA",  "Obstetrics",                "(212) 555-0118", "Clinic-3","09:00", "17:00", 20, 36.0, 0.0),
]

# id, name, mrn, phone, dob, risk_tier
PATIENTS = [
    ("SYN-00003", "Daniela Marquez",    "SYN-4471", "(212) 555-0103", "1992-03-11", "RED"),
    ("SYN-00022", "Latoya Williams",    "SYN-5108", "(646) 555-0122", "1989-07-02", "RED"),
    ("SYN-00027", "Mei Chen",           "SYN-6033", "(347) 555-0127", "1995-11-20", "RED"),
    ("SYN-00021", "Fatou Diallo",       "SYN-4990", "(718) 555-0121", "1990-01-09", "AMBER"),
    ("SYN-00016", "Rosa Gutierrez",     "SYN-4612", "(212) 555-0116", "1986-05-30", "AMBER"),
    ("SYN-00034", "Aaliyah Johnson",    "SYN-7120", "(646) 555-0134", "1998-09-14", "AMBER"),
    ("SYN-00015", "Hannah Goldberg",    "SYN-4580", "(718) 555-0115", "1991-02-18", "AMBER"),
    ("SYN-00004", "Olivia Bennett",     "SYN-4419", "(212) 555-0104", "1994-12-01", "GREEN"),
    ("SYN-00009", "Priscilla Adeyemi",  "SYN-4503", "(646) 555-0109", "1996-06-22", "GREEN"),
    ("SYN-00010", "Nadia Hussain",      "SYN-4527", "(347) 555-0110", "1988-08-08", "GREEN"),
    ("SYN-00028", "Carmen Ortiz",       "SYN-6041", "(212) 555-0128", "1993-04-27", "GREEN"),
    ("SYN-00033", "Sandra Okeke",       "SYN-7098", "(718) 555-0133", "1985-10-15", "GREEN"),
]

# (id, patient_id, provider_id, date, time, duration_min, type, reason, status)
# Today's clinic + clusters on p1 (Okonkwo) and p2 (Stein) Jun 16-19 so the PTO
# overlap-conflict (UC4) impacts real OB appointments.
APPOINTMENTS = [
    ("a1",  "SYN-00004", "p1", TODAY, "08:00", 20, "Prenatal",     "28-wk prenatal",     "Booked"),
    ("a2",  "SYN-00003", "p1", TODAY, "09:00", 20, "Prenatal",     "Prenatal f/u",       "Booked"),
    ("a3",  "SYN-00016", "p3", TODAY, "13:00", 30, "GYN Annual",   "Well-woman",         "Booked"),
    ("a4",  "SYN-00027", "p1", TODAY, "14:20", 20, "New OB",       "New OB intake",      "Booked"),
    ("a5",  "SYN-00022", "p7", TODAY, "10:30", 30, "Prenatal",     "Midwife prenatal",   "Booked"),
    ("a6",  "SYN-00021", "p7", TODAY, "11:00", 30, "Postpartum",   "6-wk postpartum",    "Booked"),
    ("a7",  "SYN-00034", "p4", TODAY, "15:30", 30, "Colposcopy",   "Abnormal Pap f/u",   "Booked"),
    ("a8",  "SYN-00009", "p5", TODAY, "09:40", 30, "MFM Consult",  "High-risk consult",  "Booked"),
    ("a9",  "SYN-00033", "p3", TODAY, "11:30", 30, "GYN Annual",   "Well-woman",         "Booked"),
    ("a10", "SYN-00010", "p9", TODAY, "12:00", 30, "GYN F/U",      "IUD check",          "Booked"),
    # Okonkwo (p1) cluster Jun 16-18 — impacted by her PTO
    ("a11", "SYN-00015", "p1", "2026-06-16", "08:00", 20, "Prenatal", "32-wk prenatal",  "Booked"),
    ("a12", "SYN-00028", "p1", "2026-06-16", "09:20", 20, "Prenatal", "Prenatal f/u",    "Booked"),
    ("a13", "SYN-00021", "p1", "2026-06-17", "08:40", 20, "New OB",   "New OB intake",    "Booked"),
    ("a14", "SYN-00034", "p1", "2026-06-18", "14:00", 20, "Prenatal", "Prenatal f/u",    "Booked"),
    # Stein (p2) cluster Jun 17-19 — the OVERLAP window with Okonkwo
    ("a15", "SYN-00022", "p2", "2026-06-17", "09:00", 20, "Prenatal", "30-wk prenatal",  "Booked"),
    ("a16", "SYN-00003", "p2", "2026-06-18", "10:00", 20, "Prenatal", "Prenatal f/u",    "Booked"),
]

# id, provider_id, start, end, type, status
# Two Obstetrics providers with OVERLAPPING leave (Jun 17-19) → uncovered OB window (UC4).
# Okonkwo's request starts Pending (the one the approver opens); Stein's is already Approved.
PTO_BLOCKS = [
    ("pto1", "p2", "2026-06-17", "2026-06-19", "CME",      "Approved"),
    ("pto2", "p1", "2026-06-16", "2026-06-20", "Vacation", "Pending"),
]
