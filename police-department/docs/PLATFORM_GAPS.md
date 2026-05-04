# Platform Gaps & Outstanding Work

What the demo deliberately stubs, why, and what would graduate it. None of these are blockers for the live demo; they are tracked here so a future engineer doesn't think the gap is an oversight.

## 1. Authorino is installed but no AuthPolicy is wired on the platform

**Gap**: The persona FastAPI Route is unauthenticated. The Tekton EventListener Route is unauthenticated.

**Why we accepted it**: The platform installs the Authorino operator subscription but never creates an `AuthPolicy` or `AuthConfig`. We don't want this demo to be the first AuthPolicy on the cluster — that would couple platform hardening to a single demo's release cycle.

**Graduation**: When the platform adds a baseline AuthConfig (Keycloak token validation), this demo subscribes by adding an `AuthPolicy` selecting `pd-persona`/`pd-perception-el` Routes.

## 2. Vault is dev-mode; secrets are direct `Secret` resources

**Gap**: `pd-aurora-credentials`, `pd-portkey-key`, `pd-s3-creds`, `pd-hf-token` are populated by `bootstrap/01_secrets.sh` from env vars and stored as plain `Secret` resources.

**Why we accepted it**: Platform's Vault is dev-mode (single replica, no unseal automation, no External Secrets Operator wiring). Plumbing demo secrets through Vault would mean wiring an integration the platform itself doesn't use yet — net negative.

**Graduation**: When the platform installs External Secrets Operator + a `ClusterSecretStore` pointing at Vault, replace the four Secret stubs with `ExternalSecret` resources.

## 3. ServiceMeshMemberRoll vs per-namespace ServiceMeshMember

**Gap**: The platform's `ServiceMeshMemberRoll` in `istio-system` lists `ai-demo, knative-serving, langchain` and is owned by `ai-demo-stack-aws`. We need our two namespaces in the mesh too.

**Why we accepted it**: We use per-namespace `ServiceMeshMember` resources in `pd-cctv` and `pd-personas`. This is the documented Maistra/OSSM alternative for namespaces wanting to opt-in without modifying a centralised SMMR. Mesh membership works identically; Kiali shows both.

**Graduation**: Eventually the platform will likely move to a single `ServiceMeshMember`-per-namespace pattern across the board (or to a `ServiceMeshControlPlane.spec.members` sidecar mode). Either way, no demo-side change required.

## 4. AWS Lambda S3 → Tekton bridge replaced by an in-cluster CronJob

**Gap**: Spec asks for an S3 ObjectCreated → Lambda → EventListener pipeline. We ship an in-cluster CronJob polling every 60 s.

**Why we accepted it**: The Lambda requires AWS-write privileges and IAM provisioning that fall outside the cluster's GitOps boundary, and the platform Terraform is not modifiable from this demo. The CronJob keeps the demo entirely inside the cluster, fully observable in OCP.

**Graduation**: `terraform/lambda-s3-bridge.tf.example` is the upgrade path. Rename, `terraform apply`, then `oc -n pd-cctv patch cronjob pd-s3-watcher --type=merge -p '{"spec":{"suspend":true}}'`.

## 5. `kube_deployment_status_replicas_ready` label is environment-specific

**Gap**: The PrometheusRule's `expr` assumes the kube-state-metrics output uses `deployment` (not `deployment_name`). If the platform upgrades kube-state-metrics, the rule may need a label fix.

**Why we accepted it**: We are pinned to the platform's current monitoring stack. Validate the metric label once after each platform upgrade.

**Graduation**: A future iteration could use a `RecordingRule` to derive a label-stable metric `pd:gpu_active{namespace,model}` and base the alert on that.

## 6. The bootstrap script is shell, not a controller

**Gap**: `bootstrap/01_secrets.sh` is bash. It has the usual fragility of bash (env var quoting, idempotency rests on SSA).

**Why we accepted it**: A controller (or a Tekton bootstrap pipeline) would be heavier infrastructure for a demo. Shell + SSA is the platform's convention too.

**Graduation**: If we ship 3+ demos, refactor bootstrap into a tiny Go controller that reconciles a `DemoSubsystem` CRD.

## 7. Open WebUI is not extended with a HITL plugin

**Gap**: The original spec mounts a JS plugin into the platform's Open WebUI Deployment.

**Why we accepted it**: Mutating a platform-owned Deployment violates the no-writes rule, and standing up a second Open WebUI in `pd-cctv` doubles the operational footprint. We ship our own HTMX-based queue page served from the persona FastAPI.

**Graduation**: When Open WebUI plugins become a first-class feature with a sidecar/extension mechanism, swap our HTMX page for a plugin manifest.
