#!/usr/bin/env bash
# =============================================================================
#  Amboy NPI-Safe demo — DEPLOY (on top of the ai-demo-stack-AWS platform)
#
#  Scoped + idempotent. Creates ONLY demo-owned objects: three amboy S3 buckets
#  (SSE, public-access-blocked) + a scoped IAM user, the out-of-band amboy-creds
#  Secret (Aurora endpoint/password from SSM), an in-cluster image build
#  (internal registry — same pattern as the police-department demo), the
#  standalone ArgoCD Application (kustomize overlay over ../amboy-baremetal),
#  seeds, the AWS-replumbed training pipeline, and the Tekton pipelines.
#  Reuses AWS-stack services (Aurora+pgvector, S3, portkey, vault, keycloak).
#
#  Usage:    ./deploy.sh
#  Override: KUBECONFIG, AWS_PROFILE, GIT_REVISION, PORTKEY_API_KEY, VAULT_TOKEN via env.
#  Pairs with destroy.sh (scoped, label-guarded teardown).
# =============================================================================
set -euo pipefail
DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$DEMO_DIR/../amboy-baremetal" && pwd)"   # app source of truth
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'
info(){ echo -e "  ${CYAN}➤${RESET} $*"; }
ok(){   echo -e "  ${GREEN}✔${RESET} $*"; }
warn(){ echo -e "  ${YELLOW}⚠${RESET} $*"; }
err(){  echo -e "  ${RED}✘${RESET} $*" >&2; exit 1; }

NS=amboy
AWS_PROFILE="${AWS_PROFILE:-rhoai-demo}"; export AWS_PROFILE
AWS_REGION="${AWS_REGION:-us-east-1}"
BUCKETS="ai-demo-amboy-raw ai-demo-amboy-deid ai-demo-amboy-pipelines"
IAM_USER="amboy-demo-s3-rw"
SSM_PREFIX="/ai-demo/aurora"
GIT_REVISION="${GIT_REVISION:-sanjeev-dev}"
VAULT_TOKEN="${VAULT_TOKEN:-Demo1234#}"
PORTKEY_API_KEY="${PORTKEY_API_KEY:-}"

echo -e "${CYAN}${BOLD}┌───────────────────────────────────────────────┐
│  Amboy NPI-Safe demo — deploy (AWS)            │
└───────────────────────────────────────────────┘${RESET}"

# ── 0. preflight ─────────────────────────────────────────────────────────────
info "Phase 0 — preflight"
for t in oc aws python3; do command -v "$t" >/dev/null 2>&1 || err "missing tool: $t"; done
oc whoami >/dev/null 2>&1 || err "not authenticated — export KUBECONFIG=.../ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig"
aws sts get-caller-identity >/dev/null 2>&1 || err "AWS session expired — run: aws sso login --profile $AWS_PROFILE"
# shared platform services the demo consumes (never creates)
oc -n ai-demo get svc portkey >/dev/null 2>&1 || err "portkey.ai-demo missing — is the AWS stack deployed?"
oc -n vault get svc vault >/dev/null 2>&1 || err "vault.vault missing"
oc -n rhoai-sso get svc keycloak >/dev/null 2>&1 || warn "keycloak.rhoai-sso missing (dev-mode auth still works)"
ok "cluster $(oc whoami --show-server) ; AWS account $(aws sts get-caller-identity --query Account --output text)"

# ── 0b. AWS resources (idempotent): S3 buckets + scoped IAM user ─────────────
info "Phase 0b — S3 buckets (SSE, public-access-blocked) + IAM user $IAM_USER"
for b in $BUCKETS; do
  if ! aws s3api head-bucket --bucket "$b" 2>/dev/null; then
    aws s3api create-bucket --bucket "$b" --region "$AWS_REGION" >/dev/null
    info "  created s3://$b"
  fi
  aws s3api put-bucket-encryption --bucket "$b" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null
  aws s3api put-public-access-block --bucket "$b" --public-access-block-configuration \
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' >/dev/null
done
ok "buckets ready: $BUCKETS"

aws iam create-user --user-name "$IAM_USER" >/dev/null 2>&1 || true
POLICY_FILE="$(mktemp)"; trap 'rm -f "$POLICY_FILE"' EXIT
cat > "$POLICY_FILE" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "AmboyObjects", "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::ai-demo-amboy-*/*" },
    { "Sid": "AmboyBuckets", "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:CreateBucket",
                 "s3:GetEncryptionConfiguration", "s3:PutEncryptionConfiguration",
                 "s3:GetBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy"],
      "Resource": "arn:aws:s3:::ai-demo-amboy-*" },
    { "Sid": "AmboyList", "Effect": "Allow",
      "Action": "s3:ListAllMyBuckets", "Resource": "*" }
  ]
}
JSON
aws iam put-user-policy --user-name "$IAM_USER" --policy-name amboy-s3-rw --policy-document "file://$POLICY_FILE" >/dev/null
ok "IAM inline policy amboy-s3-rw scoped to ai-demo-amboy-*"

# key-rotation guard (pd pattern): reuse the live key if it still exists in IAM.
oc get ns "$NS" >/dev/null 2>&1 || oc create ns "$NS" >/dev/null
LIVE_AKID="$(oc -n "$NS" get secret amboy-creds -o jsonpath='{.data.S3_ACCESS_KEY}' 2>/dev/null | base64 -d || true)"
EXISTING_KEYS="$(aws iam list-access-keys --user-name "$IAM_USER" --query 'AccessKeyMetadata[].AccessKeyId' --output text)"
if [ -n "$LIVE_AKID" ] && echo "$EXISTING_KEYS" | tr '\t' '\n' | grep -qx "$LIVE_AKID"; then
  S3_ACCESS_KEY="$LIVE_AKID"
  S3_SECRET_KEY="$(oc -n "$NS" get secret amboy-creds -o jsonpath='{.data.S3_SECRET_KEY}' | base64 -d)"
  ok "reusing live S3 access key $S3_ACCESS_KEY"
else
  # make room (IAM max 2 keys), then mint a fresh pair
  NKEYS="$(echo "$EXISTING_KEYS" | wc -w | tr -d ' ')"
  if [ "$NKEYS" -ge 2 ]; then
    OLDEST="$(aws iam list-access-keys --user-name "$IAM_USER" --query 'sort_by(AccessKeyMetadata,&CreateDate)[0].AccessKeyId' --output text)"
    aws iam delete-access-key --user-name "$IAM_USER" --access-key-id "$OLDEST"
    info "  deleted oldest IAM key $OLDEST (2-key quota)"
  fi
  read -r S3_ACCESS_KEY S3_SECRET_KEY <<<"$(aws iam create-access-key --user-name "$IAM_USER" \
      --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)"
  ok "minted fresh S3 access key $S3_ACCESS_KEY"
fi

# ── 0c. Aurora coordinates from SSM ──────────────────────────────────────────
info "Phase 0c — Aurora endpoint/creds from SSM $SSM_PREFIX/*"
PG_HOST="$(aws ssm get-parameter --name "$SSM_PREFIX/endpoint" --query 'Parameter.Value' --output text)"
PG_PASSWORD="$(aws ssm get-parameter --name "$SSM_PREFIX/master-password" --with-decryption --query 'Parameter.Value' --output text)"
[ -n "$PG_HOST" ] && [ -n "$PG_PASSWORD" ] || err "could not read Aurora coordinates from SSM"
ok "Aurora: $PG_HOST (db rhoai_demo)"

# ── 1. out-of-band Secret amboy-creds (NOT in git → ArgoCD never blanks it) ──
# Raw key names (S3_ACCESS_KEY, PG_PASSWORD, …) are what the manifests'
# secretKeyRef entries and the DSPA s3CredentialsSecret expect. The AMBOY_*
# duplicates make `envFrom: secretRef` feed app/common/config.py DIRECTLY —
# on baremetal workloads without explicit env fell back to config defaults
# that happened to match the in-stack services; on AWS they must not.
info "Phase 1 — amboy-creds Secret in ns $NS"
oc -n "$NS" create secret generic amboy-creds \
  --from-literal=PG_PASSWORD="$PG_PASSWORD" \
  --from-literal=S3_ACCESS_KEY="$S3_ACCESS_KEY" \
  --from-literal=S3_SECRET_KEY="$S3_SECRET_KEY" \
  --from-literal=VAULT_TOKEN="$VAULT_TOKEN" \
  --from-literal=PORTKEY_API_KEY="$PORTKEY_API_KEY" \
  --from-literal=AMBOY_PG_HOST="$PG_HOST" \
  --from-literal=AMBOY_PG_PASSWORD="$PG_PASSWORD" \
  --from-literal=AMBOY_S3_ACCESS_KEY="$S3_ACCESS_KEY" \
  --from-literal=AMBOY_S3_SECRET_KEY="$S3_SECRET_KEY" \
  --from-literal=AMBOY_VAULT_TOKEN="$VAULT_TOKEN" \
  --from-literal=AMBOY_PORTKEY_API_KEY="$PORTKEY_API_KEY" \
  --dry-run=client -o yaml | oc apply -f - >/dev/null
oc -n "$NS" annotate secret amboy-creds "argocd.argoproj.io/sync-options=Prune=false" --overwrite >/dev/null
ok "amboy-creds ready (out-of-band, Prune=false)"
[ -n "$PORTKEY_API_KEY" ] || warn "PORTKEY_API_KEY is empty — the agent falls back to deterministic mode (no LLM narration)"

# ── 2. in-cluster image builds (internal registry; source = ../amboy-baremetal) ──
info "Phase 2 — in-cluster builds (several minutes — torch + MiniLM bake)"
oc -n "$NS" apply -f "$DEMO_DIR/build/buildconfig-aws.yaml" >/dev/null
oc -n "$NS" apply -f "$DEMO_DIR/build/web-buildconfig-aws.yaml" >/dev/null
# --wait makes start-build return non-zero on build failure (--follow alone does not)
oc -n "$NS" start-build amboy --from-dir="$BASE_DIR" --follow --wait \
  || err "amboy image build FAILED — see: oc -n $NS logs build/amboy-<n>"
oc -n "$NS" start-build amboy-web --from-dir="$BASE_DIR/web" --follow --wait \
  || err "amboy-web image build FAILED — see: oc -n $NS logs build/amboy-web-<n>"
ok "images built → image-registry…/$NS/{amboy,amboy-web}:latest"

# ── 3. standalone ArgoCD Application ─────────────────────────────────────────
info "Phase 3 — ArgoCD Application (targetRevision=$GIT_REVISION)"
sed "s|targetRevision: sanjeev-dev|targetRevision: $GIT_REVISION|" \
  "$DEMO_DIR/gitops/application.yaml" | oc apply -f - >/dev/null
ok "Application amboy-demo applied"

# ── 4. wait for sync + health ────────────────────────────────────────────────
info "Phase 4 — waiting for ArgoCD to sync the demo (up to ~10 min)…"
sync=""; health=""
for i in $(seq 1 120); do
  sync="$(oc -n openshift-gitops get applications.argoproj.io amboy-demo -o jsonpath='{.status.sync.status}' 2>/dev/null || true)"
  health="$(oc -n openshift-gitops get applications.argoproj.io amboy-demo -o jsonpath='{.status.health.status}' 2>/dev/null || true)"
  [ "$sync" = "Synced" ] && [ "$health" = "Healthy" ] && break
  sleep 5
done
echo "    sync=$sync health=$health"
[ "${sync:-}" = "Synced" ] || warn "app not fully Synced yet — check: oc -n openshift-gitops get app amboy-demo"

# ── 4b. pin the KServe model + agents to the freshly-built DIGEST ─────────────
info "Phase 4b — pin model + agents to the built image digest"
DIG="$(oc -n "$NS" get istag amboy:latest -o jsonpath='{.image.metadata.name}' 2>/dev/null || true)"
IMG="image-registry.openshift-image-registry.svc:5000/$NS/amboy:latest"
if [ -n "$DIG" ]; then
  IMG="image-registry.openshift-image-registry.svc:5000/$NS/amboy@${DIG}"
  oc -n "$NS" patch inferenceservice amboy-pii-model --type=json \
    -p "[{\"op\":\"replace\",\"path\":\"/spec/predictor/containers/0/image\",\"value\":\"${IMG}\"}]" >/dev/null 2>&1 || true
  for d in amboy-deid-gateway amboy-compare-agent; do
    oc -n "$NS" patch deploy "$d" --type=json \
      -p "[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/image\",\"value\":\"${IMG}\"}]" >/dev/null 2>&1 || true
  done
  ok "pinned to digest ${DIG#sha256:}"
else
  warn "could not read amboy:latest digest — services stay on :latest"
fi

# ── 4c. seed the BASE PII model into S3 (served from S3) ─────────────────────
info "Phase 4c — publish base PII model to S3 (idempotent)"
oc -n "$NS" delete job amboy-seed-base --ignore-not-found >/dev/null 2>&1 || true
oc -n "$NS" apply -f "$DEMO_DIR/build/seed-base-job-aws.yaml" >/dev/null
oc -n "$NS" wait --for=condition=complete job/amboy-seed-base --timeout=300s \
  && ok "base PII model published to s3://ai-demo-amboy-deid/models/base/" \
  || warn "seed-base job not complete — model falls back to the baked copy"

# ── 4d. upload the AWS-replumbed training pipeline to the Pipeline Server ─────
info "Phase 4d — OpenShift AI training pipeline (Data Science Pipelines)"
oc -n "$NS" wait --for=condition=Ready datasciencepipelinesapplication/amboy-dsp --timeout=600s >/dev/null 2>&1 \
  && {
    oc -n "$NS" create configmap amboy-compile-aws \
      --from-file=compile_aws.py="$DEMO_DIR/build/compile_aws.py" \
      --dry-run=client -o yaml | oc apply -f - >/dev/null
    oc -n "$NS" delete job amboy-pipeline-upload --ignore-not-found >/dev/null 2>&1 || true
    sed "s|__AMBOY_IMAGE__|$IMG|" "$DEMO_DIR/build/pipeline-upload-job-aws.yaml" | oc -n "$NS" apply -f - >/dev/null
    oc -n "$NS" wait --for=condition=complete job/amboy-pipeline-upload --timeout=240s \
      && ok "training pipeline uploaded (OpenShift AI → Data Science Pipelines / Experiments)" \
      || warn "pipeline upload job not complete — check: oc -n $NS logs job/amboy-pipeline-upload"
  } \
  || warn "DSP Pipeline Server not Ready — skipping pipeline upload (optional)"

# ── 5. seed synthetic reports into the S3 raw bucket ─────────────────────────
info "Phase 5 — seed synthetic reports into s3://ai-demo-amboy-raw"
oc -n "$NS" delete job amboy-seed --ignore-not-found >/dev/null 2>&1 || true
oc -n "$NS" apply -f "$DEMO_DIR/build/seed-job-aws.yaml" >/dev/null
oc -n "$NS" wait --for=condition=complete job/amboy-seed --timeout=180s \
  && ok "synthetic reports seeded" \
  || warn "seed job not complete — you can still upload reports from the UI"

# ── 6. OpenShift AI dashboard launcher tile (best-effort) ────────────────────
info "Phase 6 — OpenShift AI Applications launcher tile (best-effort)"
oc apply -f "$DEMO_DIR/gitops/openshift-ai-tile.yaml" >/dev/null 2>&1 \
  && ok "Applications tile 'Amboy NPI-Safe' applied" \
  || warn "tile skipped (no perms on redhat-ods-applications) — optional/cosmetic"

# ── 7. OpenShift Pipelines (Tekton) for the non-ML functionality ─────────────
# 00-rbac is the hand-merged AWS copy (union of the two per-tier Roles); the
# other five manifests are sed-transformed from the baremetal source of truth
# (namespace + registry path + service DNS all embed iis-ai-*).
info "Phase 7 — OpenShift Pipelines (Tekton)"
TEKTON_OK=1
oc apply -f "$DEMO_DIR/tekton/00-rbac.yaml" >/dev/null 2>&1 || TEKTON_OK=0
for f in tasks amboy-doc-process amboy-comparison amboy-governance amboy-build-deploy; do
  sed -e 's/iis-ai-ai/amboy/g' -e 's/iis-ai-ui/amboy/g' \
    "$BASE_DIR/tekton/$f.yaml" | oc apply -f - >/dev/null 2>&1 || TEKTON_OK=0
done
[ "$TEKTON_OK" = 1 ] \
  && ok "Tekton pipelines applied (tkn pipeline ls -n $NS; see tekton/README.md)" \
  || warn "Tekton apply incomplete — is the OpenShift Pipelines operator installed?"

# ── done ─────────────────────────────────────────────────────────────────────
ROUTE="$(oc -n "$NS" get route amboy-web -o jsonpath='{.spec.host}' 2>/dev/null || echo '<pending>')"
UIROUTE="$(oc -n "$NS" get route amboy-ui -o jsonpath='{.spec.host}' 2>/dev/null || echo '<pending>')"
echo -e "
${GREEN}${BOLD}AMBOY DEPLOYED ON AWS.${RESET}
  Web UI    : https://${ROUTE}
  Streamlit : https://${UIROUTE}
  Storage   : s3://ai-demo-amboy-{raw,deid,pipelines} (SSE-S3, IAM user $IAM_USER)
  Database  : Aurora $PG_HOST (schema amboy, pgvector)
  npi-reveal: demo mode — toggle the role in the UI (X-Amboy-Roles header)
  Verify    : make verify           (offline, runs in ../amboy-baremetal)
              make verify-cluster    (live ingest, /detokenize 403, prompt scan)
"
