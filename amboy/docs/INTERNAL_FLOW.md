# Amboy — Internal System Flow (upload → report)

How a request moves through the system, step by step, with the stack component
used at each hop. Everything runs on the **ai-demo-stack-baremetal** OpenShift
cluster (CPU-only). The browser only ever talks to the UI over an edge-TLS Route;
all east-west traffic is plain http over in-cluster Service DNS.

## Components & where they run

| Component | Namespace / kind | Role in the flow |
|---|---|---|
| `amboy-web` (React + **nginx BFF**) | iis-ai-ui · Deployment+Route | UI; same-origin `/api/*` proxy to the services (browser holds no keys, no NPI) |
| `amboy-deid-gateway` (FastAPI) | iis-ai-ai | the **privacy boundary** — extract, de-identify, tokenize, index, reveal, purge |
| `amboy-presidio-analyzer` / `-anonymizer` | iis-ai-ai (official CPU images) | NER detection of PII (called by the gateway with custom bank recognizers) |
| `amboy-metrics-engine` (FastAPI) | iis-ai-ai | **deterministic** YoY compare / scenario / policy flags over NPI-free facts |
| `amboy-compare-agent` (FastAPI + LangGraph) | iis-ai-ai | RAG chat (SSE), doc extraction, insight, audit read, branded PDF export |
| **Postgres + pgvector** | iis-ai-data (reused) | `amboy.chunks` (de-id text + 384-dim vectors), `report_facts`/`sector_facts`/`loan_facts`, encrypted `token_vault`, append-only `audit_log` |
| **MinIO** (S3) | iis-ai-data (reused) | `amboy-raw` (seeded NPI reports) / `amboy-deid` (token-only docs) |
| **Vault transit** | iis-ai-system (reused) | deterministic HMAC token + reversible encrypt/decrypt of NPI values |
| **Keycloak** | iis-ai-system (reused) | OIDC; `npi-reveal` role gates re-identification (dev mode: `X-Amboy-Roles`) |
| **Portkey gateway → Anthropic Claude** | iis-ai-ai → external | the **only egress**; the LLM the agent narrates with (`claude-sonnet-4-6`) |
| MiniLM (sentence-transformers) | baked into the image | local CPU embeddings — de-id text is vectorized in-cluster, never sent out |
| MLflow · n8n · Grafana | iis-ai-system / iis-ai-ui (reused) | eval logging · ingest+sign-off workflow · governance dashboard |
| ArgoCD · OpenShift BuildConfig + internal registry | openshift-gitops / in-cluster | GitOps sync of manifests; in-cluster image builds (no ECR) |

> **Trust boundary = the Portkey egress.** NPI is detected and tokenized *before*
> anything is embedded, indexed, logged, or sent to the model. NPI only ever
> exists as Vault-transit ciphertext in `token_vault`.

---

## Phase 0 — Sign in
1. Browser loads `amboy-web` over the **edge-TLS Route** (`iis-ai-ui`).
2. User authenticates. **Keycloak** OIDC in prod; in this demo, a role picker sets
   the `X-Amboy-Roles` header (`AUTH_DEV_MODE`). Unauthenticated users are routed
   to sign-in.

## Phase 1 — Upload & index (once per report)
3. On **New comparison** the user names the comparison and drops two files
   (PDF/DOCX/TXT/MD/JSON). → `amboy-web`.
4. Browser `POST /api/ingest_document` (multipart) → **nginx BFF** rewrites to
   `amboy-deid-gateway /ingest_document` (same-origin; no CORS, no self-signed TLS).
5. **Extract text** — `pypdf` (PDF) / `python-docx` (DOCX) / decode (txt/md). → deid-gateway.
6. **Detect NPI** — `deid.deidentify_text` calls **Presidio analyzer** (with custom
   bank ad-hoc recognizers) **∪** the in-house regex recognizers (`pii_patterns`),
   then merges the spans. Regex guarantees coverage even if Presidio is down.
7. **Tokenize (before the boundary)** — each PII span → a deterministic token via
   **Vault transit HMAC** (`[ENTITY:hex]`, same value → same token). The original
   value is **encrypted** (Vault transit) and stored as ciphertext in
   `amboy.token_vault` (Postgres). NPI now exists only encrypted.
8. **Chunk + embed locally** — the token-only text is chunked and each chunk is
   embedded with **MiniLM** (baked in the image, CPU) → 384-dim vector. Nothing is
   sent out to vectorize.
9. **Index** — chunks (`deid_text` + `embedding`) written to **pgvector**
   (`amboy.chunks`, keyed `comparison_id::side`); idempotent re-ingest.
   *(Seeded structured path: `/ingest` reads the JSON from MinIO `amboy-raw`,
   tokenizes structured fields + notes, writes NPI-free `report_facts`/`sector_facts`/
   `loan_facts`, and the token-only doc to MinIO `amboy-deid`.)*
10. **Audit** — an NPI-free row (chunks, tokens, kind) → append-only `amboy.audit_log`.
11. UI polls `GET /api/comparisons/{id}/status` (→ compare-agent counts) and shows the
    **de-identification summary** (N entities tokenized · 0 left in index · ready to chat).

## Phase 2 — Open workspace: the left panel
12. **Seeded comparison (structured):** `POST /api/compare` + `/api/flag_policy` →
    **metrics-engine** computes YoY deltas, ratios and policy flags **in code** from
    the facts tables → KPI tiles + YoY chart + flags, labeled *"verified · computed in code."*
13. **Uploaded comparison (free-form):** `POST /api/compare_docs` → **compare-agent**
    retrieves the de-id chunks for both sides and asks **Claude (via Portkey)** to
    extract comparable figures **present in the text** (tokens never resolved) →
    KPI tiles + movers chart + A/B bars, labeled *"extracted from documents · review
    before use."* Deltas are computed in the browser (deterministic arithmetic).

## Phase 3 — Chat (the centerpiece)
14. User asks a question → `POST /api/chat` (Server-Sent Events) → **compare-agent**:
    - a. **Embed** the question locally (MiniLM).
    - b. **Retrieve** top-k de-id chunks from **pgvector** (cosine `<=>`), filtered to
      the comparison's reports (`report_ids` and/or `comparison_id::%`).
    - c. **Get verified facts** from **metrics-engine** `/compare` (seeded) — or a clean
      "none" signal for uploads (no internal errors surfaced).
    - d. **Build the prompt** — system rules (*narrate only verified numbers, never
      resolve a token, cite sources by id, label recommendations DRAFT*) + facts +
      retrieved context, each chunk tagged `[chunk:id]`.
    - e. **Stream the LLM via Portkey → Claude.** ⟵ **trust boundary**: only tokens +
      numbers cross egress; NPI never does.
    - f. Emit SSE `delta` events (text) then a `meta` event `{citations, tokens, draft}`.
    - g. **Audit** the turn (prompt hash, citation ids, latency — NPI-free).
15. `amboy-web` renders the streamed markdown: **citation pills**, **sealed token chips**,
    **DRAFT** badge; the completed answer auto-projects to the left Insight panel.

## Phase 4 — Gated reveal (only if a sealed token is tapped)
16. User taps a `[ENTITY:hex]` chip → step-up + typed reason → `POST /api/detokenize`
    → **deid-gateway**: checks the **Keycloak `npi-reveal`** role (dev: `X-Amboy-Roles`).
    403 without it.
17. With the role: look up the ciphertext in `token_vault` → **Vault transit decrypt**
    → return the value briefly (watermarked in the UI, cleared on blur). **Never via the
    LLM.** A reveal **audit** row (actor, token, outcome) is written.

## Phase 5 — Export, delete, governance
18. **Download PDF** → `POST /api/chat_pdf` → compare-agent renders a **branded reportlab
    PDF** (Amboy mark header + IIS footer) of the transcript; citation markers stripped,
    tokens stay opaque.
19. **Delete** → `POST /api/purge_comparison` → deid-gateway deletes the comparison's
    `chunks` + (seeded) facts + MinIO objects to free space; audited.
20. **Governance** → `GET /api/audit` → compare-agent reads the append-only `audit_log`
    → the governance table. **Grafana** reads the same table; **n8n** runs the
    ingest + human-sign-off workflow.

---

## Why it's safe (invariants enforced along the way)
- **De-identify before the boundary** (step 6–7): no NPI in the deid object, the vector
  index, the model prompt, or `audit_log.detail`.
- **Deterministic-first** (step 12): seeded figures are computed in code; the agent only
  narrates verified numbers and cites sources (step 14d).
- **Reversible, gated re-ID** (steps 16–17): Vault transit + Keycloak role + reason +
  append-only audit; app-tier only, never the LLM.
- **Local embeddings** (step 8): even de-identified text is never sent out to vectorize.
- **GitOps + CPU-only**: one ArgoCD Application; images built in-cluster; no GPU.
