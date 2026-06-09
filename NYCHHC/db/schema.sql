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
