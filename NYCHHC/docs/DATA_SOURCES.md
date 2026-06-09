# Data Sources & Synthetic Datasets

> ⚠️ **FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA.**
> **No real PHI.** Every row below is synthetically generated. Every document
> indexed for RAG is public-domain or synthetic. There is **no** connection to
> any real EHR, HRIS, or payroll system in this demo.

This doc defines (a) the **structured synthetic datasets** seeded into Aurora so
each capability has real rows to query, and (b) the **RAG document corpus** for
grounding. It is the contract the `db-seed` and `rag-ingest` jobs implement.

---

## A. Structured operational data (Aurora PostgreSQL → schema `workforce`)

All tables live in a dedicated schema `workforce` so we never touch platform tables.
Volumes are sized for a believable demo, not scale.

### `departments` — hospital units
~12 rows across a fictional facility set ("NYC H+H — Demo General", units modeled on
real bed-types but entirely fictional).

| column | type | notes |
|--------|------|-------|
| `dept_id` | `serial PK` | |
| `name` | `text` | e.g. "Emergency", "Med-Surg 4W", "ICU", "Pediatrics" |
| `facility` | `text` | fictional facility name |
| `min_staff_ratio` | `numeric` | required staff-per-census (drives Coverage Risk) |
| `baseline_census` | `int` | typical patient load |

### `providers` — staff (MD / APP / RN)
~120 rows. **Synthetic names** generated with Faker; no real individuals.

| column | type | notes |
|--------|------|-------|
| `provider_id` | `serial PK` | |
| `name` | `text` | Faker-generated |
| `role` | `text` | `MD` / `APP` / `RN` |
| `dept_id` | `int FK` | home unit |
| `fte` | `numeric` | 0.5–1.0 |
| `seniority_years` | `int` | |

### `shifts` — scheduled coverage (the schedule of record)
~8 weeks of shifts, ~3,000 rows. This is what **Smart Scheduling** writes to (with
human approval) and what **Coverage Risk** reads.

| column | type | notes |
|--------|------|-------|
| `shift_id` | `serial PK` | |
| `provider_id` | `int FK` | |
| `dept_id` | `int FK` | |
| `shift_date` | `date` | |
| `block` | `text` | `day` / `evening` / `night` |
| `status` | `text` | `scheduled` / `open` / `swapped` / `cancelled` |

### `pto_requests` — time-off (drives PTO Impact, 4.2)
~200 rows, some overlapping to create realistic coverage gaps.

| column | type | notes |
|--------|------|-------|
| `pto_id` | `serial PK` | |
| `provider_id` | `int FK` | |
| `start_date` / `end_date` | `date` | |
| `status` | `text` | `pending` / `approved` / `denied` |
| `requested_at` | `timestamptz` | |

### `appointments` — patient flow (drives No-Show, 4.3)
~5,000 rows over 8 weeks. **Synthetic patients** (Faker), de-identified by design —
no MRN, no DOB, only a surrogate `patient_ref`.

| column | type | notes |
|--------|------|-------|
| `appt_id` | `serial PK` | |
| `patient_ref` | `text` | surrogate id, e.g. `SYN-000123` |
| `dept_id` | `int FK` | |
| `appt_datetime` | `timestamptz` | |
| `lead_time_days` | `int` | booked-ahead days (no-show feature) |
| `prior_noshows` | `int` | history count (feature) |
| `age_band` | `text` | `0-17` / `18-39` / `40-64` / `65+` (no exact age) |
| `outcome` | `text` | `attended` / `no_show` / `cancelled` (label for training) |

### `embeddings` — pgvector RAG store (schema `rag`)
| column | type | notes |
|--------|------|-------|
| `id` | `serial PK` | |
| `source` | `text` | which doc (see §B) |
| `chunk` | `text` | the text chunk |
| `embedding` | `vector(1024)` | 1024-dim to match Titan Embed v2 (diagram) |
| `metadata` | `jsonb` | title, url, section |

> **IVFFlat index** created after load: `CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops)`.

### Seed approach
`scripts/bootstrap.sh` → `ingestion/seed_workforce.py` (Faker + fixed RNG seed for
reproducible demos). All generated `.csv` snapshots also land in
`ingestion/seed-data/` so the demo is runnable without re-generating.

---

## B. RAG document corpus (public-domain / synthetic)

Grounds the copilot's policy answers. Target ~150–300 chunks for the demo (small,
fast, enough to retrieve meaningfully). **Every source documented; nothing scraped
that isn't public-domain.**

| Source | Type | License / basis | Used for |
|--------|------|-----------------|----------|
| Synthetic **Staffing & Coverage Policy** (we author) | Markdown | Our content, CC0 | min staff ratios, escalation thresholds |
| Synthetic **PTO Policy** (we author) | Markdown | Our content, CC0 | PTO approval rules, blackout periods |
| **CDC** clinical/operational guidance (public) | HTML | U.S. Gov public domain | care-pathway context |
| **NIH / MedlinePlus** (public) | HTML | U.S. Gov public domain | general clinical reference |
| **AHRQ** workforce/patient-flow briefs (public) | HTML/PDF | U.S. Gov public domain | patient-flow best practices |

> The **operational policy** docs (staffing ratios, PTO rules) are the ones the
> agent actually cites in the hero flow — we author these synthetically so they're
> internally consistent with the seeded data. CDC/NIH/AHRQ provide credible
> clinical color but are secondary.

### Ingestion pipeline (`ingestion/`)
1. `sources.yaml` — declares each source URL + license + chunking params.
2. `scrape.py` — fetch public docs (respect robots.txt; public-domain only).
3. `embed.py` — chunk → embed **via Portkey** (Titan Embed v2 / fallback) → upsert pgvector.
4. `seed-data/` — committed sample so the demo runs offline.

---

## C. De-identification policy

**HIPAA / de-identification is intentionally out of scope for this demo** (per your
direction). We rely on the data being **synthetic-by-construction**:

- No MRN, no SSN, no DOB, no real names, no addresses.
- Patients are surrogate refs (`SYN-#####`); ages are **bands**, not exact.
- Provider names are Faker-generated and fictional.

What this means: there is **no de-identification step to get wrong**, because there is
nothing real to de-identify. The production path (Presidio scrubber or the platform's
Vault-backed transformation service) is described in
[COMPLIANCE.md](COMPLIANCE.md) as a "what changes for real PHI" item.

The **demo banner** — *"FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC
DATA"* — appears on every UI page and in every API response envelope regardless.
