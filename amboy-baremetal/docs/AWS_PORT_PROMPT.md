# Prompt: port Amboy from the baremetal stack to the AWS AI stack

Paste the block below into a NEW session to deploy the Amboy demo on the AWS AI stack.
Source of truth = `company-demos/amboy-baremetal/` (this repo). AWS variant goes in a new
`company-demos/amboy-aws/`. The baremetal demo is left untouched.

---

```
# TASK: Port the "Amboy NPI-Safe Report Comparison" demo from the baremetal stack to the AWS AI stack

You are deploying an existing, fully-working OpenShift demo onto our AWS AI stack (the
OCP-on-AWS / ROSA + OpenShift AI platform built in the session "Important: IaC AWS- AI
Stack"). It currently runs on ai-demo-stack-baremetal; stand it up on AWS using
AWS-native services where they fit, WITHOUT changing what the demo does.

## 0. Source of truth (reuse the app — do NOT rewrite it)
- App code: `company-demos/amboy-baremetal/` (branch sanjeev-dev). Read its
  README.md, ARCHITECTURE.md, CLAUDE.md FIRST.
- One image, roles via $AMBOY_ROLE (deid_gateway, metrics_engine, compare_agent, ui,
  pii_model, seed, seed_base) + a React web UI (web/). All endpoints/creds come from
  app/common/config.py via env overrides (AMBOY_S3_*, AMBOY_PG_*, AMBOY_PII_MODEL_URL,
  PORTKEY_*, ...). The Python/React logic is platform-agnostic — porting is config, IAM,
  storage, registry, and GitOps plumbing, not app rewrites.
- Put the AWS variant in a NEW dir `company-demos/amboy-aws/` (prefer a shared kustomize
  base + overlays/{baremetal,aws} if it keeps app manifests DRY). Do not modify amboy-baremetal.

## Feature parity that MUST work after the port
1. React UI, 3 functions: Sensitive Document Intake (de-identify a report -> stored
   de-identified artifact), Compare and Vectorize Documents (comparability -> accept
   fields -> index), AI Insights from Documents (grounded chat with report-aware
   suggested prompts the LLM authors at comparability time).
2. Privacy: de-identify BEFORE the LLM/vector/logs; reversible tokenization; gated
   re-identification (role npi-reveal); append-only NPI-free audit; local MiniLM embeddings.
3. PII/NPI detector served on OpenShift AI (KServe) — Piiranha/DeBERTa, base model in
   object storage (served from S3), plus a fine-tuned head with an ACCOUNT class.
4. Model Training console driven by a real OpenShift AI Data Science Pipeline (KFP v2):
   ingest->featurize->train->evaluate(logs accuracy)->register->deploy(re-provision
   KServe)->smoke; tracked under Experiments and runs.
5. OpenShift Pipelines (Tekton) for the non-ML paths (tekton/): build-deploy, doc-process,
   comparison, governance — reuse the BuildConfigs/services, don't reimplement.
6. deploy.sh / destroy.sh / demo-reset.sh equivalents that work on AWS.

## 1. FIRST: discover the AWS stack (confirm, don't assume)
- Find the AWS stack repo (likely ai-demo-stack-aws, sibling of ai-demo-stack-baremetal);
  read its README/CLAUDE/gitops. Check memory: reference_ai_demo_cluster.md (kubeconfig,
  AWS SSO profile rhoai-demo, Aurora SSM paths, S3 bucket). Optionally search the
  "IaC AWS- AI Stack" session transcript.
- Authenticate + inspect the LIVE cluster and record, with evidence:
  - access (aws sso login --profile / oc login), region, account, kubeconfig
  - namespaces/tiers to use (mirror the AWS stack's convention — do NOT invent)
  - OpenShift AI: `oc get datasciencecluster -o yaml` (kserve? datasciencepipelines?
    modelregistry?); OpenShift Pipelines (Tekton) operator present?
  - object storage: in-cluster MinIO or AWS S3 (which bucket/prefix, SSE-KMS)?
  - database: in-cluster Postgres+pgvector or Aurora PostgreSQL (is the `vector`
    extension available? creds in Secrets Manager/SSM?)
  - image build/registry: in-cluster BuildConfig (as baremetal) or ECR (+ CodeBuild or
    `oc` build pushing to ECR)? Where does the cluster pull app images from?
  - secrets: out-of-band Secret or AWS Secrets Manager / SSM via External Secrets/CSI?
  - pod->AWS auth: IRSA (IAM Roles for Service Accounts)
  - LLM egress: keep Portkey->Anthropic, or Amazon Bedrock (Claude)?
  - reused identity/keys: Vault or AWS KMS (tokenization); Keycloak or Cognito (npi-reveal)
- Produce an "AWS stack facts" summary and CONFIRM before building.

## 2. Baremetal -> AWS mapping (apply where supported; keep the rest cloud-agnostic)
- MinIO buckets (amboy-raw/deid/pipelines) -> S3 buckets/prefixes (SSE-KMS), IRSA
- Postgres+pgvector -> Aurora PostgreSQL + pgvector (keep in-cluster PG if Aurora lacks vector)
- BuildConfig + ImageStream -> ECR (build via CodeBuild or `oc start-build` pushing to ECR)
- out-of-band amboy-creds Secret -> Secrets Manager/SSM via External Secrets + IRSA
- Vault transit tokenize key -> AWS KMS (keep the tokenizer's pluggable backend)
- Keycloak npi-reveal -> Cognito/Keycloak (keep AMBOY_AUTH_DEV_MODE for the demo)
- Portkey->Anthropic -> Bedrock (Claude) or Portkey (keep grounding guard + max_tokens)
- KServe serving + DSP training pipeline: reuse as-is if RHOAI is present; storage = S3

## 3. Hard rules (from amboy-baremetal/CLAUDE.md)
- NEVER edit the platform repos (ai-demo-stack-aws/-baremetal). The demo is a standalone
  ArgoCD Application that only CONSUMES platform services; surface platform needs as
  "Decision Needed."
- Use the AWS stack's FIXED namespaces; prefix amboy-, label demo: amboy (label-scoped
  teardown, never delete a shared namespace).
- De-identify before the trust boundary; NPI only leaves as ciphertext; audit NPI-free;
  LLM narrates only verified numbers (grounding guard). Secrets never in git.

## 4. Watch out for (lessons already learned — see amboy memory)
- KServe can serve a STALE cached :latest digest -> pin the freshly-built digest on the
  InferenceService/Deployments; ArgoCD ignoreDifferences + RespectIgnoreDifferences protect it.
- KServe may drop the ClusterIP the gateway calls -> own a stable Service.
- DSP (KFP v2) caching replays cached success without side effects -> disable caching per
  task; in-cluster KFP API is behind an oauth-proxy on :8443 (grant the caller SA `get`
  on the ds-pipeline-* route); no non-ASCII in pipeline docstrings (latin1 DB); grant the
  pipeline-runner-* SA the RBAC the steps need.
- Tekton: `oc get pipeline` is ambiguous (Tekton + Kubeflow) -> use FQN
  pipelines.tekton.dev; ClusterTask removed in Pipelines 1.22 -> define Tasks; binary
  BuildConfigs need a git-clone + workspace.
- AWS-specific: IRSA for S3+Aurora+Secrets; Aurora needs the `vector` extension; ECR pull
  secrets/image refs; SSE-KMS on S3.

## 5. Deliverables + acceptance
- Amboy deployed on the AWS stack with full feature parity (Section "Feature parity").
- Idempotent deploy.sh / destroy.sh / demo-reset.sh for AWS; docs updated.
- Verify: intake de-identifies; comparability->index->AI-Insights chat is grounded +
  NPI-free; /detokenize 403 without the role, 200 with it; PII model served on KServe from
  S3; a training run executes as a DSP pipeline (Experiments and runs) + re-provisions the
  model; the four Tekton pipelines run; audit rows NPI-free.
- Keep the OpenShift AI model + Data Science Pipeline as the training path (no bespoke
  loop). Present a plan + the "AWS stack facts" for approval BEFORE building.

Start by reading company-demos/amboy-baremetal/{README,ARCHITECTURE,CLAUDE}.md, then
discover the AWS stack (Section 1), then propose the plan.
```
