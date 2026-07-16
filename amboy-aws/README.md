# Amboy — NPI-Safe Investment & Credit Report Comparison (AWS)

The AWS-stack port of [`../amboy-baremetal`](../amboy-baremetal/README.md) — same
demo, same app code, AWS-native plumbing. Runs on the **ai-demo-stack-aws**
platform (OCP 4.21 on AWS, RHOAI 2.25, `*.apps.ai-demo.iisdemolab.click`) via
**one ArgoCD Application**.

**The app is not forked.** All Python/React/pipeline code, the Dockerfiles, and
the base manifests live in `../amboy-baremetal` (read-only from here). This dir
holds only the AWS re-plumb:

| Baremetal | AWS (this port) |
|---|---|
| 4 fixed `iis-ai-*` tiers | ONE demo-owned ns `amboy` (AWS-stack convention, like `pd-*`) |
| in-stack MinIO buckets | **S3** `ai-demo-amboy-{raw,deid,pipelines}` (SSE-S3, public-access-blocked, scoped IAM user `amboy-demo-s3-rw`) |
| in-stack Postgres+pgvector | **Aurora PostgreSQL 16.4 + pgvector** (`ai-demo-db`, coords from SSM `/ai-demo/aurora/*`) |
| `portkey.iis-ai-ai:8787` | `portkey.ai-demo:8787` (same Portkey→Anthropic trust boundary) |
| `vault.iis-ai-system:8200` | `vault.vault:8200` (same transit key `amboy-npi-tokenize`) |
| `keycloak.iis-ai-system` | `keycloak.rhoai-sso` (demo keeps `AMBOY_AUTH_DEV_MODE=1`) |
| cephfs RWX (Tekton ws) | EFS `efs-sc` |
| registry path `iis-ai-*/…` | `amboy/…` (in-cluster BuildConfig — the AWS internal registry is S3-backed and Managed; **no ECR needed**, same pattern as the police-department demo) |

## How the re-plumb works (all config, no code)

- **`gitops/manifests/`** — a kustomize **overlay** over the baremetal base:
  `prep/` dedupes what a namespace-flatten would collide (the twin `amboy`
  ServiceAccounts), the parent flattens everything into ns `amboy`, rewrites the
  image paths, and patches endpoints. App workloads get
  `envFrom: [amboy-aws-env ConfigMap, amboy-creds Secret]` — every endpoint is an
  env override consumed by `app/common/config.py`.
- **`build/compile_aws.py`** — the DSP training pipeline's task pods read the
  same config env, so this compiles the *unmodified* baremetal pipeline and
  post-processes the KFP IR: non-secret `AMBOY_*` endpoints inline, secrets via
  kfp-kubernetes `secretAsEnv` from `amboy-creds` (never plaintext in the IR).
- **`web-nginx/default.conf`** — the web BFF bakes its upstreams at image build;
  the overlay mounts this amboy-ns conf over the baked one (no image fork).
- **`tekton/`** — only `00-rbac.yaml` (hand-merged Role union) and the EFS
  workspace template are AWS files; the four pipelines are sed-transformed from
  the baremetal source at deploy time.

## Run it

```bash
aws sso login --profile rhoai-demo
export KUBECONFIG=~/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig

make verify                      # OFFLINE gate (runs in ../amboy-baremetal)
PORTKEY_API_KEY=sk-ant-… ./deploy.sh    # idempotent AWS deploy
make verify-cluster              # LIVE gate: ingest, /detokenize 403, NPI scan, audit
./demo-reset.sh                  # between demos (keeps base model + pipelines)
./destroy.sh [--aws]             # teardown (--aws also removes buckets + IAM user)
```

`deploy.sh` phases: S3 buckets + IAM user (+ key-rotation guard) → Aurora coords
from SSM → out-of-band `amboy-creds` → in-cluster builds of `amboy` + `amboy-web`
(source `../amboy-baremetal`) → ArgoCD Application → digest pin (KServe stale
`:latest` protection) → base-model seed to S3 → DSP pipeline upload (AWS-replumbed)
→ reports seed → RHOAI tile → Tekton.

- Web UI: `https://amboy-web-amboy.apps.ai-demo.iisdemolab.click`
- Model serving / pipelines: OpenShift AI dashboard → Data Science Project **amboy**

## Feature parity vs baremetal (all kept)

React UI (Intake → Compare & Vectorize → AI Insights with report-aware prompts);
de-identify **before** the Portkey trust boundary; reversible Vault-transit
tokenization + gated `/detokenize` (role `npi-reveal`); NPI-free append-only
audit; local MiniLM embeddings; Piiranha PII/NPI detector on **KServe**
(RawDeployment, base model served from **S3**, fine-tuned ACCOUNT head); Model
Training as a real **Data Science Pipeline** (KFP v2, Experiments and runs);
four **Tekton** pipelines.

## Known deltas (cosmetic)

- The UI's "Experiments" deep-link path embeds `iis-ai-ai`
  (`app/compare_agent/pipeline_client.py:links()` hardcodes the project segment);
  on AWS the runs live under project `amboy` — one nav click away in the RHOAI
  dashboard. Fix belongs upstream in amboy-baremetal (make the ns env-driven).
- The Grafana governance dashboard ConfigMap lands in ns `amboy`; the AWS
  stack's Grafana sidecar may not watch that ns — import
  `gitops/manifests/assets/grafana` JSON manually if the dashboard is wanted.
- IRSA is not used: the platform's IRSA roles are bound to `ai-demo`-namespace
  SAs only (platform change out of scope) — the demo uses a scoped IAM user,
  the same pattern as the police-department demo.

See [`../amboy-baremetal/ARCHITECTURE.md`](../amboy-baremetal/ARCHITECTURE.md)
for the data flow and [`CLAUDE.md`](CLAUDE.md) for AWS-port conventions.
