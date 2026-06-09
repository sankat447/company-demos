-- NYCHHC demo — workforce + rag schemas on the PLATFORM Aurora.
-- Demo-OWNED objects only (schemas workforce, rag). Never touches platform tables.
-- destroy.sh drops these schemas; the Aurora cluster itself is untouched.
-- FOR DEMONSTRATION ONLY — SYNTHETIC DATA.

CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector (platform Aurora already has it)

CREATE SCHEMA IF NOT EXISTS workforce;
CREATE SCHEMA IF NOT EXISTS rag;

-- ── workforce (operational data) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workforce.departments (
  dept_id          int PRIMARY KEY,
  name             text NOT NULL,
  min_staff_ratio  numeric NOT NULL,
  baseline_census  int NOT NULL
);

CREATE TABLE IF NOT EXISTS workforce.providers (
  provider_id  int PRIMARY KEY,
  name         text NOT NULL,
  role         text NOT NULL CHECK (role IN ('MD','APP','RN')),
  dept_id      int NOT NULL REFERENCES workforce.departments(dept_id)
);

CREATE TABLE IF NOT EXISTS workforce.shifts (
  shift_id     serial PRIMARY KEY,
  provider_id  int NOT NULL REFERENCES workforce.providers(provider_id),
  dept_id      int NOT NULL REFERENCES workforce.departments(dept_id),
  shift_date   date NOT NULL,
  block        text NOT NULL CHECK (block IN ('day','evening','night')),
  status       text NOT NULL CHECK (status IN ('scheduled','open','swapped','cancelled'))
);

CREATE TABLE IF NOT EXISTS workforce.pto_requests (
  pto_id       serial PRIMARY KEY,
  provider_id  int NOT NULL REFERENCES workforce.providers(provider_id),
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  status       text NOT NULL CHECK (status IN ('pending','approved','denied'))
);

CREATE TABLE IF NOT EXISTS workforce.appointments (
  appt_id        serial PRIMARY KEY,
  patient_ref    text NOT NULL,             -- surrogate id; NO real PHI
  dept_id        int NOT NULL REFERENCES workforce.departments(dept_id),
  provider_id    int NOT NULL REFERENCES workforce.providers(provider_id),
  appt_date      date NOT NULL,
  lead_time_days int NOT NULL,
  prior_noshows  int NOT NULL,
  age_band       text NOT NULL,             -- band, not exact age
  outcome        text NOT NULL CHECK (outcome IN ('attended','no_show','cancelled'))
);

-- ── rag (pgvector store; 1024-dim to match Titan Embed v2) ───────────────────
CREATE TABLE IF NOT EXISTS rag.embeddings (
  id        serial PRIMARY KEY,
  source    text NOT NULL,
  chunk     text NOT NULL,
  embedding vector(1024),
  metadata  jsonb
);

-- ── Minimal deterministic seed (mirrors the backend offline fake) ────────────
-- Enough for the 5-beat flow: one engineered understaffed Tuesday in Emergency +
-- computable no-show rates. The FULL synthetic seed (Faker, thousands of rows) +
-- embeddings are loaded by ingestion/ in a later step; this guarantees the demo
-- has data the moment deploy.sh finishes.
INSERT INTO workforce.departments (dept_id, name, min_staff_ratio, baseline_census) VALUES
  (1,'Emergency',6.0,40), (2,'Med-Surg 4W',4.0,28), (3,'Pediatrics',3.0,18)
ON CONFLICT (dept_id) DO NOTHING;

INSERT INTO workforce.providers (provider_id, name, role, dept_id) VALUES
  (1,'Alice Nguyen','MD',1),(2,'Ben Carter','MD',1),(3,'Carla Diaz','APP',2),
  (4,'David Okafor','RN',2),(5,'Emma Schmidt','MD',3),(6,'Frank Russo','RN',3),
  (7,'Grace Lee','APP',1),(8,'Hassan Ali','RN',1)
ON CONFLICT (provider_id) DO NOTHING;

-- 14 days of day-block shifts; Emergency providers 1 & 7 are 'open' on the next
-- Tuesday → the engineered coverage gap.
INSERT INTO workforce.shifts (provider_id, dept_id, shift_date, block, status)
SELECT p.provider_id, p.dept_id, d::date, 'day',
       CASE WHEN d::date = (CURRENT_DATE + ((9 - EXTRACT(DOW FROM CURRENT_DATE)::int) % 7) * INTERVAL '1 day')
                 AND p.dept_id = 1 AND p.provider_id IN (1,7)
            THEN 'open' ELSE 'scheduled' END
FROM workforce.providers p
CROSS JOIN generate_series(CURRENT_DATE, CURRENT_DATE + 13, INTERVAL '1 day') AS d
WHERE NOT EXISTS (SELECT 1 FROM workforce.shifts);

INSERT INTO workforce.pto_requests (provider_id, start_date, end_date, status)
SELECT 2,
       (CURRENT_DATE + ((9 - EXTRACT(DOW FROM CURRENT_DATE)::int) % 7) * INTERVAL '1 day')::date,
       (CURRENT_DATE + ((9 - EXTRACT(DOW FROM CURRENT_DATE)::int) % 7) * INTERVAL '1 day' + INTERVAL '1 day')::date,
       'pending'
WHERE NOT EXISTS (SELECT 1 FROM workforce.pto_requests);

-- ~35 days of appointments with outcomes → no-show rates by provider.
INSERT INTO workforce.appointments
  (patient_ref, dept_id, provider_id, appt_date, lead_time_days, prior_noshows, age_band, outcome)
SELECT 'SYN-' || lpad((row_number() OVER ())::text, 5, '0'),
       p.dept_id, p.provider_id, (CURRENT_DATE - g)::date,
       3 + (g % 21), (p.provider_id + g) % 4, '40-64',
       CASE WHEN ((p.provider_id + g) % 4) >= 2 AND (3 + (g % 21)) > 10
                 AND ((row_number() OVER ()) % 3 = 0)
            THEN 'no_show' ELSE 'attended' END
FROM workforce.providers p
CROSS JOIN generate_series(1, 35) AS g
WHERE p.dept_id IN (1,2,3) AND p.provider_id <= 6
  AND NOT EXISTS (SELECT 1 FROM workforce.appointments);

-- ============================================================================
--  Phase 2 — rich Med-Surg 4W unit snapshot for the wireframe UI.
--  Seeded verbatim from the approved wireframe (ROSTER/RISK/PTO/BAL) so the
--  live data API returns the exact realistic synthetic data. No PHI.
-- ============================================================================
CREATE TABLE IF NOT EXISTS workforce.roster (
  id serial PRIMARY KEY, ini text, color text, name text, role text, license text,
  phone text, shift text, weekly_hours numeric, status text,
  pto_balance_pct int, pto_balance_hours int);
CREATE TABLE IF NOT EXISTS workforce.risk_today (
  id serial PRIMARY KEY, tier text, patient_name text, syn_id text, mrn text,
  phone text, appt_time text, provider text, risk_pct int, factors jsonb, action text);
CREATE TABLE IF NOT EXISTS workforce.pto_queue (
  id serial PRIMARY KEY, ini text, color text, provider_name text, type text,
  dates text, coverage_gap boolean, status text);

INSERT INTO workforce.roster (ini,color,name,role,license,phone,shift,weekly_hours,status,pto_balance_pct,pto_balance_hours)
SELECT * FROM (VALUES
  ('MA','#3a0b5e','Dr. Marcus Adebayo','Hospitalist · MD','NY-MD-887214','(212) 555-0142','Days',40.0,'On shift',78,156),
  ('PV','#6a1f9e','Priya Venkatesan, RN','Charge Nurse · RN','NY-RN-553090','(212) 555-0118','Days',36.0,'On shift',54,108),
  ('YT','#0f9e8e','Yuki Tanaka, NP','Nurse Practitioner','NY-NP-310455','(212) 555-0156','Evening',32.0,'On shift',66,132),
  ('JO','#b8730a','James O''Sullivan, RN','Staff Nurse · RN','NY-RN-771265','(646) 555-0173','Nights',36.0,'Available',31,62),
  ('AM','#c62828','Aisha Mohammed, RN','Staff Nurse · RN','NY-RN-664120','(718) 555-0109','Evening',40.0,'On shift',NULL,NULL),
  ('HK','#6a1f9e','Hannah Kim, RN','Staff Nurse · RN','NY-RN-449871','(212) 555-0127','Nights',44.5,'OT watch',12,24),
  ('DO','#0f9e8e','David Okonkwo, RN','Float Pool · RN','NY-RN-902331','(646) 555-0164','Days',24.0,'Available',NULL,NULL),
  ('SR','#3a0b5e','Sofia Rossi, RN','Staff Nurse · RN','NY-RN-128744','(212) 555-0135','Evening',32.0,'On shift',NULL,NULL),
  ('CM','#564f6b','Carlos Mendez','Patient Care Tech','NY-PCT-20418','(347) 555-0188','Days',40.0,'On shift',NULL,NULL),
  ('LN','#564f6b','Linh Nguyen','Patient Care Tech','NY-PCT-20655','(718) 555-0191','Nights',36.0,'On shift',NULL,NULL)
) v WHERE NOT EXISTS (SELECT 1 FROM workforce.roster);

INSERT INTO workforce.risk_today (tier,patient_name,syn_id,mrn,phone,appt_time,provider,risk_pct,factors,action)
SELECT * FROM (VALUES
  ('RED','Robert Castellano','#3 · SYN-00003','SYN-4471','(212) 555-0103','9:00 AM','Dr. Adebayo',71,'["3 prior no-shows","No reminder confirmed","Rain forecast"]'::jsonb,'Call + overbook'),
  ('RED','Gloria Fitzpatrick','#22 · SYN-00022','SYN-5108','(646) 555-0122','10:30 AM','Y. Tanaka, NP',74,'["3 prior no-shows","Transit > 45 min"]'::jsonb,'Call + overbook'),
  ('RED','Darnell Brooks','#27 · SYN-00027','SYN-6033','(347) 555-0127','2:15 PM','Dr. Adebayo',75,'["3 prior no-shows","First visit","No text on file"]'::jsonb,'Call patient'),
  ('AMBER','Anthony Russo','#21 · SYN-00021','SYN-4990','(718) 555-0121','11:00 AM','Y. Tanaka, NP',54,'["2 prior no-shows"]'::jsonb,'Send text reminder'),
  ('AMBER','Mei-Ling Chen','#16 · SYN-00016','SYN-4612','(212) 555-0116','1:00 PM','Dr. Adebayo',52,'["2 prior no-shows","Afternoon slot"]'::jsonb,'Send text reminder'),
  ('AMBER','Grace Abara','#34 · SYN-00034','SYN-7120','(646) 555-0134','3:30 PM','Y. Tanaka, NP',35,'["Reschedule last week"]'::jsonb,'Send text reminder'),
  ('AMBER','Fatima Al-Rashid','#15 · SYN-00015','SYN-4580','(718) 555-0115','8:30 AM','Dr. Adebayo',31,'["Baseline"]'::jsonb,'Monitor'),
  ('GREEN','Samuel Greenberg','#4 · SYN-00004','SYN-4419','(212) 555-0104','8:00 AM','Dr. Adebayo',14,'["Baseline","Confirmed"]'::jsonb,'No action'),
  ('GREEN','Olivia Park','#9 · SYN-00009','SYN-4503','(646) 555-0109','9:45 AM','Y. Tanaka, NP',15,'["Baseline","Confirmed"]'::jsonb,'No action'),
  ('GREEN','Henry Nwosu','#10 · SYN-00010','SYN-4527','(347) 555-0110','12:00 PM','Dr. Adebayo',30,'["Baseline"]'::jsonb,'No action'),
  ('GREEN','Isabella Romano','#28 · SYN-00028','SYN-6041','(212) 555-0128','1:45 PM','Y. Tanaka, NP',17,'["Baseline","Confirmed"]'::jsonb,'No action'),
  ('GREEN','Wei Zhang','#33 · SYN-00033','SYN-7098','(718) 555-0133','4:00 PM','Dr. Adebayo',18,'["Baseline"]'::jsonb,'No action')
) v WHERE NOT EXISTS (SELECT 1 FROM workforce.risk_today);

INSERT INTO workforce.pto_queue (ini,color,provider_name,type,dates,coverage_gap,status)
SELECT * FROM (VALUES
  ('JO','#b8730a','James O''Sullivan, RN','Vacation','Jun 16–20',true,'pend'),
  ('SR','#3a0b5e','Sofia Rossi, RN','CME / Education','Jun 24–25',false,'pend'),
  ('AM','#c62828','Aisha Mohammed, RN','Sick','Jun 9 (today)',true,'ok'),
  ('CM','#564f6b','Carlos Mendez · PCT','Vacation','Jul 1–5',false,'ok'),
  ('HK','#6a1f9e','Hannah Kim, RN','Personal','Jun 30',false,'no')
) v WHERE NOT EXISTS (SELECT 1 FROM workforce.pto_queue);
