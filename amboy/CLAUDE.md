# CLAUDE.md — Amboy NPI-Safe demo subsystem

Primer for future Claude Code sessions in this directory.

## What this is
"NPI-Safe Investment & Credit Report Comparison" demo. Self-contained under
`company-demos/amboy/`, deployed onto the **ai-demo-stack-baremetal** platform
(NOT ai-demo-stack-aws). One image, four roles, one standalone ArgoCD Application.

## Hard rules
1. **Never write to `ai-demo-stack-baremetal/` (or `-aws/`).** Those are platform
   repos / source of truth for the cluster. The demo only *consumes* their services
   and adds its own standalone ArgoCD Application. If a platform change seems
   needed, surface it as "Decision Needed" — don't edit.
2. **Fixed tiered namespaces — never invent.** `iis-ai-ai` (gateway/agent/metrics/
   presidio), `iis-ai-ui` (UI/n8n/grafana assets), `iis-ai-data` (pg/minio jobs),
   `iis-ai-system` (vault job). Every resource sets its own `namespace:`.
3. **`amboy-` prefix + `demo: amboy` label on every resource.** Teardown is by that
   label; the shared namespaces are never deleted.
4. **CPU-only. No GPU anywhere.** External LLM via Portkey; MiniLM embeddings local.
5. **De-identify before the trust boundary (Portkey egress).** NPI only ever exists
   as Vault-transit ciphertext in `amboy.token_vault`. Audit `detail` is NPI-free.
6. **LLM narrates verified numbers only.** Numbers come from `metrics_engine`; the
   `compare_agent/grounding.py` guard rejects ungrounded figures.
7. **Secrets out-of-band.** `amboy-creds` is created by `deploy.sh`, never in git, so
   ArgoCD selfHeal/prune can't blank it.

## Model training + serving (MLOps)
- **Serving**: Piiranha (PII/NPI detector) runs on **KServe** as InferenceService
  `amboy-pii-model` (role `pii_model`); base model + a fine-tuned head are served, a
  `models/active.txt` MinIO marker chooses what's loaded on startup. Gateway calls a
  stable ClusterIP `amboy-pii-model:8080` (we own it — KServe's own svc naming varies).
- **Training = an OpenShift AI Data Science Pipeline (KFP v2)**, NOT an in-app loop.
  `app/pipeline/` defines the pipeline (ingest→featurize→train→evaluate→register→
  deploy→smoke) on the amboy image; `DataSciencePipelinesApplication amboy-dsp`
  (`24-pipeline-server.yaml`) is the Pipeline Server (MinIO `amboy-pipelines` bucket +
  operator MariaDB). The console (`/model-training`) submits/tracks runs via the agent
  (`compare_agent/pipeline_client.py` → KFP REST); runs show under **Experiments and
  runs**. The terminal there only tests the served model + manages ACCOUNT regex rules.
- **MLOps gotchas** (see [[rhoai-data-science-pipelines-gotchas]]): disable KFP
  caching on every task; KFP API in-cluster is via the oauth-proxy on :8443 (grant the
  SA `get` on the ds-pipeline route); no non-ASCII in pipeline docstrings (latin1 DB);
  grant `pipeline-runner-amboy-dsp` the RBAC steps need (can't set a task pod SA).
- **OpenShift AI Applications tile**: `gitops/openshift-ai-tile.yaml` (OdhApplication
  in `redhat-ods-applications`) — applied by deploy.sh, removed by destroy.sh (it's
  outside the kustomize base / the four tiers).

## OpenShift Pipelines (Tekton) — non-ML only (`tekton/`)
Tekton (the OpenShift Pipelines operator) is SEPARATE from the OpenShift AI Data
Science Pipelines above. `tekton/` holds 4 pipelines that REUSE the existing
BuildConfigs + deployed services (no logic duplicated) and never touch the model/DSP:
`amboy-build-deploy` (clone→build amboy+web→roll deid/agent/web→smoke),
`amboy-doc-process`, `amboy-comparison`, `amboy-governance`. SA `amboy-pipeline`
(00-rbac.yaml). `oc get pipeline` is ambiguous (Tekton + Kubeflow) — use
`pipelines.tekton.dev`. Applied by deploy.sh Phase 7; swept by destroy.sh.

## Scripts
`deploy.sh` (full bring-up), `destroy.sh` (label-scoped teardown), `demo-reset.sh`
(between-demo reset: base model, clear rules/uploads/comparisons/DSP runs; KEEPS the
pipelines + seeded baseline). All idempotent.

## Layout
- `app/common/` — config, pii_patterns (ONE recognizer set), tokenizer, deid,
  embeddings, db, objstore, auth. `app/{deid_gateway,metrics_engine,compare_agent,ui,pii_model}/`,
  `app/pipeline/` (KFP v2 training pipeline).
- `build/` — Dockerfile (single-stage UBI py311; lib→lib64 trap avoided), entrypoint
  (dispatch on `$AMBOY_ROLE`), buildconfig (ImageStream + binary build + puller RB),
  seed-job. `data/generate.py` — seeded synthetic reports.
- `gitops/manifests/` — kustomize base (00 SA → 10/11/12 bootstrap → 20 presidio →
  22 pii-model (KServe) → 24 pipeline-server (DSP) → 30 deid → 40 metrics → 50 agent →
  60 ui → 61 web → assets). `gitops/application.yaml` — App (ignoreDifferences +
  RespectIgnoreDifferences for the model image digest + display-name).
  `gitops/openshift-ai-tile.yaml` — Applications launcher tile (out-of-band).
- `sql` lives at `gitops/manifests/sql/01-schema.sql` (kustomize can't read `../`).
- `tests/` — privacy_invariants.py, test_metrics.py, test_grounding.py (offline);
  e2e.sh (live).

## Sync waves (within the demo Application)
1 bootstrap jobs · 2 presidio + deid + metrics · 3 compare-agent · 4 ui.

## Reused platform services (do not duplicate)
postgres+pgvector `iis-ai-postgres-primary.iis-ai-data:5432` (rhoai_demo) ·
minio `minio.iis-ai-data:9000` · portkey `portkey.iis-ai-ai:8787` · vault
`vault.iis-ai-system:8200` (transit key `amboy-npi-tokenize`) · keycloak
`keycloak.iis-ai-system:8080` (role `npi-reveal`) · mlflow `mlflow.iis-ai-system:5000`.

## Validate before commit
```bash
make verify   # offline privacy/metrics/grounding gates
make lint     # yaml/json/python/bash
make build    # kustomize build
```
`make verify-cluster` runs the live gate after `./deploy.sh`.

## Demo-vs-prod gaps
Vault DEV mode; `AMBOY_AUTH_DEV_MODE=1` trusts `X-Amboy-Roles` (prod verifies the
Keycloak JWT); MinIO SSE needs a KMS. All flagged in code + README.
