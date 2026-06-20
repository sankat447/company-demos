# Amboy — Architecture

## Trust boundary

The **only** egress is the Portkey gateway. Everything left of it runs in-cluster
on plain http Service DNS. NPI must never cross the boundary — not in prompts,
the vector store, the de-id MinIO bucket, logs, or `audit_log.detail`.

```
                         ┌─────────────────────── in-cluster (no NPI egress) ───────────────────────┐
 user ─ HTTPS(edge) ─▶ UI ─http─▶ deid-gateway ─http─▶ Presidio analyzer (CPU)        Vault transit
 (iis-ai-ui)             │            │  │                                            (HMAC + encrypt)
                         │            │  └─ tokenize (deterministic) ──────────────────────┘
                         │            ├─▶ Postgres: report/sector/loan FACTS (numbers, tokens)
                         │            ├─▶ pgvector: de-id CHUNKS + local MiniLM embeddings
                         │            ├─▶ MinIO: raw (NPI) / deid (tokens) buckets
                         │            └─▶ token_vault (ciphertext) + append-only audit_log
                         │
                         ├─http─▶ metrics-engine  /compare /scenario /flag_policy  (DETERMINISTIC)
                         │
                         └─http─▶ compare-agent (LangGraph) ── tools ─▶ metrics-engine + retrieve
                                        │  narrate verified numbers only
                                        └────────────────────────────────────────▶ Portkey ─▶ ext LLM
                                                                                    (TRUST BOUNDARY)
```

## Data flow

1. **Ingest** (`deid-gateway /ingest`): read a report (MinIO raw or inline).
   - Structured PII fields → deterministic token via Vault HMAC; original stored
     as Vault-transit ciphertext in `token_vault` (reversible, gated).
   - Free-text notes → Presidio (PERSON/LOCATION + bank ad-hoc recognizers) **∪**
     regex sweep → spans merged → replaced with stable tokens.
   - Numeric financials/sector/loan data → `*_facts` tables (NPI-free).
   - De-id notes → local MiniLM embedding → `chunks` (pgvector).
   - De-id document → MinIO deid bucket. NPI-free audit row written.
2. **Compare** (`metrics-engine`): all diffs, ratios, concentration, and rate-shock
   sensitivity computed in code. No forecasting from two snapshots.
3. **Narrate** (`compare-agent`): LangGraph ReAct agent calls the tools, then the
   LLM narrates **only** figures present in tool outputs. A grounding check rejects
   any ungrounded number; recommendations are prefixed `DRAFT — requires sign-off`.
4. **Reveal** (`deid-gateway /detokenize`): app-tier only, requires the Keycloak
   `npi-reveal` role, decrypts via Vault transit, writes an audit row (never the value).

## Determinism & reproducibility

- Synthetic data is RNG-seeded (`data/generate.py`, seed 20240620).
- Tokenization is deterministic: same value → same token, so the model can reason
  about an entity across both reports without seeing it.
- Numbers are single-sourced in `metrics_engine/compute.py`; the grounding guard
  enforces the agent never introduces an unverified figure.

## Why these choices on baremetal

- **CPU-only**: external LLM via Portkey is the default; MiniLM embeddings are CPU
  and baked in. An optional local quantized model via KServe would be a zero-egress
  mode (not the default).
- **In-cluster build**: no ECR on baremetal → `BuildConfig` to the internal
  registry; a cross-namespace `system:image-puller` RoleBinding lets the UI tier pull.
- **Fixed namespaces + label teardown**: resources live in the shared `iis-ai-*`
  tiers (per platform rule) but carry `demo: amboy`, so teardown is label-scoped and
  never deletes a shared namespace.
