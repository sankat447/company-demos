# CLAUDE.md — Amboy NPI-Safe demo, AWS port

Primer for future Claude Code sessions in this directory.

## What this is
The AWS-stack port of `../amboy-baremetal` (which is the app source of truth —
READ ITS README/ARCHITECTURE/CLAUDE FIRST). Deployed onto **ai-demo-stack-aws**
(cluster `ai-demo`, `*.apps.ai-demo.iisdemolab.click`, AWS account 406337554361,
region us-east-1, SSO profile `rhoai-demo`). One standalone ArgoCD Application
`amboy-demo` syncing `amboy-aws/gitops/manifests` (kustomize overlay).

## Hard rules
1. **Never write to `ai-demo-stack-aws/` or `ai-demo-stack-baremetal/`** (platform
   repos). Surface platform needs as "Decision Needed".
2. **Never modify `../amboy-baremetal`** from here — it is the single source of
   truth for app code, Dockerfiles, base manifests, tekton pipelines, tests.
   AWS differences are expressed ONLY as: kustomize overlay patches, env
   overrides (config.py), sed-at-deploy transforms, or small AWS-only files in
   this dir. If a change needs baremetal edits, do it there (it's our demo repo,
   not a platform repo) and keep both stacks green.
3. **ONE demo-owned namespace `amboy`** (AWS convention = demos own their
   namespaces, like pd-*). Everything is prefixed `amboy-` + labeled
   `demo: amboy`. destroy.sh may delete ns `amboy` (ours) but NEVER a shared ns
   (ai-demo, vault, rhoai-*, openshift-*).
4. Privacy invariants are identical to baremetal: de-identify before the Portkey
   egress, NPI only as Vault-transit ciphertext, NPI-free audit, grounded-only
   narration. Secrets never in git (out-of-band `amboy-creds`, Prune=false).

## AWS plumbing map
- **S3**: `ai-demo-amboy-{raw,deid,pipelines}`, SSE-S3, public-access-blocked;
  IAM user `amboy-demo-s3-rw` (inline policy scoped to `ai-demo-amboy-*`);
  key-rotation guard in deploy.sh (IAM 2-key quota). `--aws` on destroy.sh
  removes them. IRSA NOT used (platform IRSA roles are bound to ai-demo-ns SAs).
- **Aurora**: endpoint+password read from SSM `/ai-demo/aurora/*` at deploy time
  → stamped into `amboy-creds` (`AMBOY_PG_HOST`, `PG_PASSWORD`). pgvector is
  available (pd demo already ran `CREATE EXTENSION vector`). Schema job runs
  psql from the pgvector image against Aurora. There is NO postgres pod: ad-hoc
  SQL goes through `oc exec <deid-pod> -- python` + `app.common.db` (see
  demo-reset.sh / tests/e2e.sh).
- **Endpoints**: every service URL is an env override consumed by
  `app/common/config.py`, delivered via `envFrom: [amboy-aws-env CM,
  amboy-creds Secret]` (explicit env in base manifests always wins over envFrom).
  Shared services: portkey.ai-demo:8787, vault.vault:8200 (dev root token),
  keycloak.rhoai-sso:8080, mlflow.rhoai-mlflow:5000.
- **Images**: in-cluster BuildConfigs in ns amboy (internal registry is S3-backed
  Managed — no ECR). Build source = `../amboy-baremetal` via
  `oc start-build --from-dir`. deploy.sh pins the freshly-built DIGEST on the
  ISVC + deid/agent deployments (KServe stale-`:latest` lesson); ArgoCD
  ignoreDifferences + RespectIgnoreDifferences protect the pin.
- **KServe**: `amboy-pii-model` stays RawDeployment (per-ISVC annotation; the
  cluster default is Serverless). The DSC sets `rawDeploymentServiceConfig:
  Headless` — irrelevant because we own the stable ClusterIP Service
  (22-pii-model.yaml). ns amboy is NOT a mesh member (RawDeployment needs no
  mesh; if a Route ever times out post-TLS, adopt pd's ServiceMeshMember +
  `maistra.io/expose-route` pod-label pattern).
- **DSP (KFP v2)**: DSPA `amboy-dsp` objectStorage → S3 (overlay patch). Task-pod
  env CANNOT come from the deployment manifests — `build/compile_aws.py`
  (mounted via CM `amboy-compile-aws`) compiles the unmodified baremetal
  pipeline and post-processes the IR: plain AMBOY_* endpoint env + amboy-creds
  `secretAsEnv` (kfp-kubernetes platformSpec) per executor. All baremetal DSP
  gotchas still apply (caching disabled per task, oauth-proxy :8443 + route-get
  RBAC, ASCII-only docstrings, pipeline-runner-amboy-dsp RBAC via
  amboy-isvc-scaler RoleBinding — subject ns patched in the overlay).
- **Kustomize overlay traps** (learned building this): the namespace transformer
  runs BEFORE patches → cross-tier duplicate resources must be delete-patched in
  the child `prep/` layer; delete patches need the explicit `target:` selector
  form; the `images:` transformer DOES reach `spec.predictor.containers` in the
  ISVC; RoleBinding subjects pointing at SAs not in the build (e.g.
  pipeline-runner-amboy-dsp) keep their old ns → patch explicitly.
- **Tekton**: only 00-rbac.yaml (merged Role union — two same-name Roles with
  different rules would clobber under a blind ns merge) + workspace-template
  (efs-sc) are checked in; the 5 other manifests are sed-transformed
  (`iis-ai-ai|iis-ai-ui` → `amboy`) from baremetal at deploy time (Phase 7).
- **Web BFF**: nginx upstreams are baked into the image → overlay mounts
  `web-nginx/default.conf` (amboy DNS) over `/etc/nginx/conf.d/default.conf`.

## Scripts
`deploy.sh` (idempotent full bring-up incl. AWS resources), `destroy.sh [--aws]`
(label-guarded; deletes ns amboy + optionally buckets/IAM), `demo-reset.sh`
(between-demo reset, SQL via in-pod psycopg). `make build` renders the overlay;
`make verify` runs the offline gates in ../amboy-baremetal; `make verify-cluster`
runs tests/e2e.sh (AWS-adapted).

## Known deltas
UI "Experiments" deep-link embeds `iis-ai-ai` (upstream fix: make the project
segment env-driven in pipeline_client.links()); Grafana dashboard CM may need
manual import (sidecar ns scope); tile URLs point at amboy-web-amboy route.
