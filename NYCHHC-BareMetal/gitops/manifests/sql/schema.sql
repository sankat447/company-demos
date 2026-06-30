-- NYCHHC-BareMetal demo (OBGYN AI Scheduling) — workforce (+ optional rag) schemas
-- on the in-stack PLATFORM Postgres (iis-ai-postgres-primary.iis-ai-data.svc, db rhoai_demo).
-- Demo-OWNED objects only (schemas workforce, rag). Never touches platform tables.
-- destroy.sh drops these schemas; the Postgres instance itself is untouched.
-- The sched_* tables are created idempotently by the backend at startup
-- (scheduling/seed.py) inside the workforce schema (via search_path).
-- FOR DEMONSTRATION ONLY — SYNTHETIC DATA.

CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector (image pgvector/pgvector:pg16)

CREATE SCHEMA IF NOT EXISTS workforce;
CREATE SCHEMA IF NOT EXISTS rag;

-- ── workforce (operational data) ─────────────────────────────────────────────
-- OBGYN service lines (inpatient 24/7 OB + GYN, outpatient clinic).
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

-- ── UC6 audit log (HITL gate) — every AI-proposed action's human decision ─────
-- BR-1 (nothing auto-executes) + BR-10 (attributable to a named user + timestamp).
CREATE TABLE IF NOT EXISTS workforce.audit_log (
  id          text PRIMARY KEY,            -- uuid (portable across pg + the sqlite fake)
  action      text NOT NULL,                -- e.g. 'pto_reassign', 'outreach', 'pto_decision'
  summary     text NOT NULL,
  rationale   text,
  actor_role  text NOT NULL,                -- Scheduler / Approver / Provider / Leadership
  actor_user  text NOT NULL,                -- named user (dev-mode: from X-NYCHHC-Roles)
  decision    text NOT NULL,                -- approved / modified / rejected
  outcome     text,                         -- executed / recorded / not-completed / blocked
  ts          text NOT NULL                 -- ISO timestamp (set by the app)
);

-- ── rag (pgvector store; UNUSED on baremetal — chat is router + Claude, no RAG.
--    Kept as a documented stub so the schema is complete if RAG is added later) ─
CREATE TABLE IF NOT EXISTS rag.embeddings (
  id        serial PRIMARY KEY,
  source    text NOT NULL,
  chunk     text NOT NULL,
  embedding vector(1024),
  metadata  jsonb
);

-- ── Minimal deterministic seed (feeds the CPU forecast/no-show models) ────────
INSERT INTO workforce.departments (dept_id, name, min_staff_ratio, baseline_census) VALUES
  (1,'Inpatient OB',2.0,18), (2,'Inpatient GYN',1.0,12), (3,'Outpatient Clinic',1.0,30)
ON CONFLICT (dept_id) DO NOTHING;

INSERT INTO workforce.providers (provider_id, name, role, dept_id) VALUES
  (1,'Dr. Amara Okonkwo','MD',1),(2,'Dr. Rachel Stein','MD',1),(3,'Dr. Priya Nair','MD',2),
  (4,'Dr. David Cohen','MD',2),(5,'Dr. Sofia Ramirez','MD',1),(6,'Naomi Bridges','APP',3),
  (7,'Grace Adeyemi','APP',3),(8,'Daniel Osei','APP',2)
ON CONFLICT (provider_id) DO NOTHING;

-- 14 days of day-block shifts; Inpatient OB providers 1 & 2 are 'open' on the next
-- Tuesday → an engineered coverage gap for the forecast view.
INSERT INTO workforce.shifts (provider_id, dept_id, shift_date, block, status)
SELECT p.provider_id, p.dept_id, d::date, 'day',
       CASE WHEN d::date = (CURRENT_DATE + ((9 - EXTRACT(DOW FROM CURRENT_DATE)::int) % 7) * INTERVAL '1 day')
                 AND p.dept_id = 1 AND p.provider_id IN (1,2)
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

-- ~35 days of appointments with outcomes → no-show rates by provider (model training-shaped).
INSERT INTO workforce.appointments
  (patient_ref, dept_id, provider_id, appt_date, lead_time_days, prior_noshows, age_band, outcome)
SELECT 'SYN-' || lpad((row_number() OVER ())::text, 5, '0'),
       p.dept_id, p.provider_id, (CURRENT_DATE - g)::date,
       3 + (g % 21), (p.provider_id + g) % 4, '18-39',
       CASE WHEN ((p.provider_id + g) % 4) >= 2 AND (3 + (g % 21)) > 10
                 AND ((row_number() OVER ()) % 3 = 0)
            THEN 'no_show' ELSE 'attended' END
FROM workforce.providers p
CROSS JOIN generate_series(1, 35) AS g
WHERE p.dept_id IN (1,2,3) AND p.provider_id <= 6
  AND NOT EXISTS (SELECT 1 FROM workforce.appointments);

-- ============================================================================
--  OBGYN outpatient-clinic snapshot for the dashboard UI (roster / risk / PTO).
--  Seeded synthetic; thresholds match the spec (red>65, amber 35-65, green<35).
--  No PHI. Persona: Selamawit (Scheduling Lead) operates these views.
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
  ('AO','#3a0b5e','Dr. Amara Okonkwo','Obstetrics · MD','NY-MD-887214','(212) 555-0142','Days',40.0,'On shift',78,156),
  ('RS','#6a1f9e','Dr. Rachel Stein','Obstetrics · MD','NY-MD-553090','(212) 555-0150','Days',36.0,'On shift',54,108),
  ('PN','#0f9e8e','Dr. Priya Nair','Gynecology · MD','NY-MD-310455','(212) 555-0161','Days',40.0,'On shift',66,132),
  ('NB','#b8730a','Naomi Bridges, CNM','Midwife · CNM','NY-CNM-771265','(212) 555-0156','Evening',32.0,'On shift',31,62),
  ('SR','#c62828','Dr. Sofia Ramirez','MFM · MD','NY-MD-664120','(718) 555-0172','Days',32.0,'On shift',NULL,NULL),
  ('GA','#6a1f9e','Grace Adeyemi, CNM','Midwife · CNM','NY-CNM-449871','(646) 555-0190','Days',36.0,'On shift',48,96),
  ('DC','#0f9e8e','Dr. David Cohen','Gynecology · MD','NY-MD-902331','(646) 555-0167','Days',36.0,'Available',NULL,NULL),
  ('HP','#3a0b5e','Dr. Helen Park','MFM · MD','NY-MD-128744','(212) 555-0180','Days',40.0,'On shift',NULL,NULL),
  ('DO','#564f6b','Daniel Osei, PA','Gynecology · PA','NY-PA-20418','(347) 555-0144','Days',40.0,'On shift',NULL,NULL),
  ('AR','#564f6b','Aisha Rahman, PA','Obstetrics · PA','NY-PA-20655','(212) 555-0118','Days',36.0,'Available',NULL,NULL)
) v WHERE NOT EXISTS (SELECT 1 FROM workforce.roster);

INSERT INTO workforce.risk_today (tier,patient_name,syn_id,mrn,phone,appt_time,provider,risk_pct,factors,action)
SELECT * FROM (VALUES
  ('RED','Daniela Marquez','#3 · SYN-00003','SYN-4471','(212) 555-0103','9:00 AM','Dr. Okonkwo',71,'["3 prior no-shows","No text on file","Prenatal · AM"]'::jsonb,'Call + standby'),
  ('RED','Latoya Williams','#22 · SYN-00022','SYN-5108','(646) 555-0122','10:30 AM','N. Bridges, CNM',74,'["3 prior no-shows","Transit > 45 min","Prenatal"]'::jsonb,'Call + standby'),
  ('RED','Mei Chen','#27 · SYN-00027','SYN-6033','(347) 555-0127','2:20 PM','Dr. Okonkwo',75,'["3 prior no-shows","New OB","No text on file"]'::jsonb,'Call patient'),
  ('AMBER','Fatou Diallo','#21 · SYN-00021','SYN-4990','(718) 555-0121','11:00 AM','N. Bridges, CNM',54,'["2 prior no-shows","Postpartum"]'::jsonb,'Send text reminder'),
  ('AMBER','Rosa Gutierrez','#16 · SYN-00016','SYN-4612','(212) 555-0116','1:00 PM','Dr. Nair',52,'["2 prior no-shows","Afternoon slot"]'::jsonb,'Send text reminder'),
  ('AMBER','Aaliyah Johnson','#34 · SYN-00034','SYN-7120','(646) 555-0134','3:30 PM','Dr. Cohen',38,'["Reschedule last week","Colposcopy"]'::jsonb,'Send text reminder'),
  ('AMBER','Hannah Goldberg','#15 · SYN-00015','SYN-4580','(718) 555-0115','8:00 AM','Dr. Okonkwo',36,'["Prenatal · AM"]'::jsonb,'Monitor'),
  ('GREEN','Olivia Bennett','#4 · SYN-00004','SYN-4419','(212) 555-0104','8:00 AM','Dr. Okonkwo',14,'["Confirmed","Prenatal"]'::jsonb,'No action'),
  ('GREEN','Priscilla Adeyemi','#9 · SYN-00009','SYN-4503','(646) 555-0109','9:40 AM','Dr. Ramirez',15,'["Confirmed","MFM consult"]'::jsonb,'No action'),
  ('GREEN','Nadia Hussain','#10 · SYN-00010','SYN-4527','(347) 555-0110','12:00 PM','D. Osei, PA',30,'["GYN follow-up"]'::jsonb,'No action'),
  ('GREEN','Carmen Ortiz','#28 · SYN-00028','SYN-6041','(212) 555-0128','9:20 AM','Dr. Okonkwo',17,'["Confirmed","Prenatal"]'::jsonb,'No action'),
  ('GREEN','Sandra Okeke','#33 · SYN-00033','SYN-7098','(718) 555-0133','11:30 AM','Dr. Nair',18,'["GYN annual"]'::jsonb,'No action')
) v WHERE NOT EXISTS (SELECT 1 FROM workforce.risk_today);

-- PTO queue includes the scripted UC4 OVERLAP CONFLICT: Okonkwo + Stein (both Inpatient OB)
-- out Jun 16-20 / Jun 17-19 → Inpatient OB below its 2-provider minimum (coverage_gap=true).
INSERT INTO workforce.pto_queue (ini,color,provider_name,type,dates,coverage_gap,status)
SELECT * FROM (VALUES
  ('AO','#3a0b5e','Dr. Amara Okonkwo','Vacation','Jun 16–20',true,'pend'),
  ('RS','#6a1f9e','Dr. Rachel Stein','CME / Education','Jun 17–19',true,'ok'),
  ('NB','#b8730a','Naomi Bridges, CNM','Personal','Jun 24–25',false,'pend'),
  ('DO','#564f6b','Daniel Osei · PA','Vacation','Jul 1–5',false,'ok'),
  ('GA','#6a1f9e','Grace Adeyemi, CNM','Sick','Jun 9 (today)',false,'no')
) v WHERE NOT EXISTS (SELECT 1 FROM workforce.pto_queue);
