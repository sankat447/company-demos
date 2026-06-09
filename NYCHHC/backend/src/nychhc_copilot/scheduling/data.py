"""Synthetic seed for the multi-specialty scheduling directory. NO PHI.

Fictional names · phones in the reserved 555-01xx range · MRNs SYN-xxxx.
Anchored to TODAY = 2026-06-09 (Tue) for deterministic demos.
"""

TODAY = "2026-06-09"

# id, name, credential, specialty, phone, room, work_start, work_end, slot_min, weekly_hours, ot_hours
PROVIDERS = [
    ("p1",  "Dr. Marcus Adebayo",  "MD", "Internal Medicine", "(212) 555-0142", "4W-12",   "09:00", "17:00", 30, 40.0, 0.0),
    ("p2",  "Dr. Sarah Lin",       "MD", "Internal Medicine", "(212) 555-0150", "4W-14",   "08:00", "16:00", 30, 36.0, 0.0),
    ("p3",  "Dr. Raj Patel",       "MD", "Cardiology",        "(212) 555-0161", "Cardio-3","09:00", "17:00", 30, 40.0, 2.0),
    ("p4",  "Dr. Elena Sokolova",  "MD", "Cardiology",        "(646) 555-0167", "Cardio-5","10:00", "18:00", 30, 32.0, 0.0),
    ("p5",  "Dr. Kwame Asante",    "MD", "Nephrology",        "(718) 555-0172", "Neph-2",  "09:00", "15:00", 30, 30.0, 0.0),
    ("p6",  "Dr. Omar Haddad",     "MD", "Pulmonology",       "(212) 555-0180", "Pulm-1",  "09:00", "17:00", 30, 40.0, 0.0),
    ("p7",  "Yuki Tanaka",         "NP", "Pulmonology",       "(212) 555-0156", "Pulm-2",  "09:00", "16:00", 30, 32.0, 0.0),
    ("p8",  "Dr. Grace Okafor",    "MD", "Endocrinology",     "(646) 555-0190", "Endo-4",  "09:00", "17:00", 30, 36.0, 0.0),
    ("p9",  "Dr. Maria Santos",    "MD", "Family Medicine",   "(347) 555-0144", "FM-6",    "08:00", "16:00", 30, 40.0, 0.0),
    ("p10", "Priya Venkatesan",    "NP", "Family Medicine",   "(212) 555-0118", "FM-8",    "09:00", "17:00", 30, 36.0, 0.0),
]

# id, name, mrn, phone, dob, risk_tier
PATIENTS = [
    ("SYN-00003", "Robert Castellano",  "SYN-4471", "(212) 555-0103", "1958-03-11", "RED"),
    ("SYN-00022", "Gloria Fitzpatrick", "SYN-5108", "(646) 555-0122", "1949-07-02", "RED"),
    ("SYN-00027", "Darnell Brooks",     "SYN-6033", "(347) 555-0127", "1991-11-20", "RED"),
    ("SYN-00021", "Anthony Russo",      "SYN-4990", "(718) 555-0121", "1963-01-09", "AMBER"),
    ("SYN-00016", "Mei-Ling Chen",      "SYN-4612", "(212) 555-0116", "1977-05-30", "AMBER"),
    ("SYN-00034", "Grace Abara",        "SYN-7120", "(646) 555-0134", "1985-09-14", "AMBER"),
    ("SYN-00015", "Fatima Al-Rashid",   "SYN-4580", "(718) 555-0115", "1990-02-18", "AMBER"),
    ("SYN-00004", "Samuel Greenberg",   "SYN-4419", "(212) 555-0104", "1954-12-01", "GREEN"),
    ("SYN-00009", "Olivia Park",        "SYN-4503", "(646) 555-0109", "1996-06-22", "GREEN"),
    ("SYN-00010", "Henry Nwosu",        "SYN-4527", "(347) 555-0110", "1970-08-08", "GREEN"),
    ("SYN-00028", "Isabella Romano",    "SYN-6041", "(212) 555-0128", "1982-04-27", "GREEN"),
    ("SYN-00033", "Wei Zhang",          "SYN-7098", "(718) 555-0133", "1968-10-15", "GREEN"),
]

# (id, patient_id, provider_id, date, time, duration_min, type, reason, status)
# Today's clinic + a cluster on Tanaka (p7) Jun 16-18 so PTO impact is non-trivial.
APPOINTMENTS = [
    ("a1",  "SYN-00004", "p1", TODAY, "08:00", 30, "Follow-up", "HTN check",        "Booked"),
    ("a2",  "SYN-00003", "p1", TODAY, "09:00", 30, "Follow-up", "Diabetes f/u",     "Booked"),
    ("a3",  "SYN-00016", "p1", TODAY, "13:00", 30, "Follow-up", "Med review",       "Booked"),
    ("a4",  "SYN-00027", "p1", TODAY, "14:15", 30, "New",       "New patient",      "Booked"),
    ("a5",  "SYN-00022", "p7", TODAY, "10:30", 30, "Consult",   "Pulm consult",     "Booked"),
    ("a6",  "SYN-00021", "p7", TODAY, "11:00", 30, "Follow-up", "Asthma f/u",       "Booked"),
    ("a7",  "SYN-00034", "p7", TODAY, "15:30", 30, "Follow-up", "COPD f/u",         "Booked"),
    ("a8",  "SYN-00009", "p3", TODAY, "09:45", 30, "Consult",   "Cardio consult",   "Booked"),
    ("a9",  "SYN-00033", "p3", TODAY, "11:30", 30, "Follow-up", "Post-MI f/u",      "Booked"),
    ("a10", "SYN-00010", "p9", TODAY, "12:00", 30, "Follow-up", "Annual",           "Booked"),
    # Tanaka cluster Jun 16-18 (PTO-impact demo)
    ("a11", "SYN-00015", "p7", "2026-06-16", "09:00", 30, "Follow-up", "COPD f/u",  "Booked"),
    ("a12", "SYN-00028", "p7", "2026-06-16", "10:00", 30, "Consult",   "Pulm consult","Booked"),
    ("a13", "SYN-00021", "p7", "2026-06-17", "09:30", 30, "Follow-up", "Asthma f/u", "Booked"),
    ("a14", "SYN-00034", "p7", "2026-06-18", "14:00", 30, "Follow-up", "COPD f/u",   "Booked"),
]

# id, provider_id, start, end, type, status   (one Approved block → Blocked slots demo)
PTO_BLOCKS = [
    ("pto1", "p2", "2026-06-12", "2026-06-12", "CME", "Approved"),
]
