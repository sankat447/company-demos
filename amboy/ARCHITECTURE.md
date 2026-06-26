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

## PII/NPI model on OpenShift AI (KServe)

The detector (Piiranha / DeBERTa, `pii_model` role) is served as a KServe
`InferenceService` `amboy-pii-model` (RawDeployment, CPU). The base model is stored in
in-stack MinIO and served from S3 (no external egress); a fine-tuned head adds
org-specific classes (e.g. ACCOUNT) and is loaded from MinIO. A `models/active.txt`
marker selects what is served on startup; the gateway calls a stable ClusterIP
`amboy-pii-model:8080` (we own that Service — KServe's own naming varies). The
predictor/deid/agent images are pinned to the freshly-built digest (node `:latest`
caching otherwise serves stale), with ArgoCD `ignoreDifferences` +
`RespectIgnoreDifferences` protecting the pin.

## Model training as an OpenShift AI Data Science Pipeline (KFP v2)

Training runs as a real Kubeflow Pipelines v2 DAG on the OpenShift AI Pipeline Server
(`DataSciencePipelinesApplication amboy-dsp`, MinIO-backed): ingest → featurize
(MiniLM) → train head → evaluate (logs `held_out_accuracy`) → register (MinIO +
`amboy.model_versions`) → deploy (re-provision KServe) → smoke. The `/model-training`
console submits + tracks runs via the compare-agent → KFP REST API; runs appear under
**Experiments and runs**. Caching is disabled per task (a cached "success" would skip
the real side effects). See `app/pipeline/`.

## OpenShift Pipelines (Tekton) — non-ML functionality

The build/deploy CI and the document/comparison/governance flows are expressed as
Tekton Pipelines (`tekton/`) that **reuse** the in-cluster BuildConfigs and the
deployed services over HTTP — `amboy-build-deploy` (clone → build both images → roll
app services → smoke), `amboy-doc-process`, `amboy-comparison`, `amboy-governance`.
They are additive and never touch the KServe model or the Data Science Pipeline.
The in-cluster KFP API sits behind an oauth-proxy (`:8443`); the calling SA is granted
`get` on the `ds-pipeline-*` route to pass it.
