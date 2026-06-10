#!/usr/bin/env bash
# Shared helpers for the NYCHHC demo deploy/destroy scripts.
# FOR DEMONSTRATION ONLY — SYNTHETIC DATA.
set -euo pipefail

# ── Config (override via env) ────────────────────────────────────────────────
export AWS_PROFILE="${AWS_PROFILE:-rhoai-demo}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
NS="${NYCHHC_NS:-nychhc-demo}"
PLATFORM_SSM_PREFIX="${PLATFORM_SSM_PREFIX:-ai-demo}"   # platform Aurora at /ai-demo/aurora/*
DEMO_LABEL="demo=nychhc"                                # scoped-teardown guard
PSQL_IMAGE="${PSQL_IMAGE:-registry.redhat.io/rhel9/postgresql-16:latest}"

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${DEMO_DIR}/terraform"

# ── Logging ──────────────────────────────────────────────────────────────────
c_blue=$'\033[34m'; c_grn=$'\033[32m'; c_red=$'\033[31m'; c_yel=$'\033[33m'; c_rst=$'\033[0m'
log()  { echo "${c_blue}▶ $*${c_rst}"; }
ok()   { echo "${c_grn}✔ $*${c_rst}"; }
warn() { echo "${c_yel}⚠ $*${c_rst}"; }
die()  { echo "${c_red}✘ $*${c_rst}" >&2; exit 1; }

# ── Preflight ─────────────────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }

preflight() {
  log "Preflight: tools + auth"
  for t in aws terraform oc jq; do need "$t"; done
  # No local docker/podman needed — images build in-cluster via OpenShift BuildConfig.
  # AWS SSO (≈1h TTL): the script owns the login (like the platform deploy.sh) — it
  # triggers an interactive `aws sso login` when the session is missing/expired.
  if ! aws sts get-caller-identity --profile "$AWS_PROFILE" >/dev/null 2>&1; then
    log "AWS SSO session missing/expired — launching login for profile '$AWS_PROFILE'"
    aws sso login --profile "$AWS_PROFILE"
    aws sts get-caller-identity --profile "$AWS_PROFILE" >/dev/null 2>&1 \
      || die "AWS SSO login did not complete"
  fi
  oc whoami >/dev/null 2>&1 || die "not logged into the cluster (set KUBECONFIG / oc login)"
  ok "Preflight passed ($(oc whoami) @ $(oc whoami --show-server 2>/dev/null))"
}

container_cli() { command -v docker >/dev/null 2>&1 && echo docker || echo podman; }

# ── SSM: read platform Aurora connection (READ ONLY) ──────────────────────────
ssm_get() {
  aws ssm get-parameter --profile "$AWS_PROFILE" --region "$AWS_REGION" \
    --name "$1" ${2:+--with-decryption} --query 'Parameter.Value' --output text
}

aurora_dsn() {
  local ep db pw
  ep="$(ssm_get "/${PLATFORM_SSM_PREFIX}/aurora/endpoint")"
  db="$(ssm_get "/${PLATFORM_SSM_PREFIX}/aurora/database-name")"
  pw="$(ssm_get "/${PLATFORM_SSM_PREFIX}/aurora/master-password" decrypt)"
  # User is the platform master (rhoai_admin); the demo owns SCHEMAS, not the cluster.
  echo "postgresql://rhoai_admin:${pw}@${ep}:5432/${db}"
}

# ── Run SQL against Aurora from an in-cluster ephemeral pod ───────────────────
# (Aurora is in-VPC and unreachable from a laptop; we exec from the cluster.)
run_sql_stdin() {
  local dsn="$1"
  oc -n "$NS" run "nychhc-psql-$$" --rm -i --restart=Never --image="$PSQL_IMAGE" \
    --labels="demo=nychhc" --env="PGCONN=${dsn}" --command -- \
    bash -lc 'psql "$PGCONN" -v ON_ERROR_STOP=1 -f -'
}

# ── Guard: a namespace must carry the demo label before we delete it ──────────
assert_demo_namespace() {
  local got
  got="$(oc get ns "$NS" -o jsonpath='{.metadata.labels.demo}' 2>/dev/null || true)"
  [[ "$got" == "nychhc" ]] || die "refusing to delete ns '$NS' — missing label ${DEMO_LABEL} (scoped-teardown guard)"
}

# ── Grafana (platform's, rhoai-monitoring) — add/remove ONLY the NYCHHC objects ──
GRAFANA_NS="${GRAFANA_NS:-rhoai-monitoring}"
_grafana_url() {
  local h; h="$(oc -n "$GRAFANA_NS" get route grafana -o jsonpath='{.spec.host}' 2>/dev/null)"
  [[ -n "$h" ]] && echo "https://$h" || echo ""
}
_grafana_auth() {
  local p; p="$(oc -n "$GRAFANA_NS" get deploy grafana -o jsonpath='{range .spec.template.spec.containers[0].env[?(@.name=="GF_SECURITY_ADMIN_PASSWORD")]}{.value}{end}' 2>/dev/null)"
  echo "admin:${p:-Demo1234#}"
}

grafana_provision() {
  local GURL GAUTH ep pw
  GURL="$(_grafana_url)"; GAUTH="$(_grafana_auth)"
  [[ -z "$GURL" ]] && { warn "Grafana route not found — skipping dashboard"; return 0; }
  ep="$(ssm_get "/${PLATFORM_SSM_PREFIX}/aurora/endpoint")"
  pw="$(ssm_get "/${PLATFORM_SSM_PREFIX}/aurora/master-password" decrypt)"
  log "Grafana: provision NYCHHC datasource + dashboard ($GURL)"
  # Datasource (recreate for idempotency).
  curl -sk -u "$GAUTH" -X DELETE "$GURL/api/datasources/uid/nychhc-aurora" >/dev/null 2>&1 || true
  jq -n --arg url "${ep}:5432" --arg pw "$pw" \
    '{uid:"nychhc-aurora",name:"NYCHHC Aurora",type:"postgres",access:"proxy",url:$url,user:"rhoai_admin",database:"rhoai_demo",jsonData:{sslmode:"require",postgresVersion:1600},secureJsonData:{password:$pw}}' \
    | curl -sk -u "$GAUTH" -H 'content-type: application/json' -X POST "$GURL/api/datasources" -d @- >/dev/null
  # Folder (ignore if exists).
  curl -sk -u "$GAUTH" -H 'content-type: application/json' -X POST "$GURL/api/folders" -d '{"uid":"nychhc","title":"NYCHHC"}' >/dev/null 2>&1 || true
  # Dashboard.
  jq -n --slurpfile d "$DEMO_DIR/grafana/nychhc-dashboard.json" '{dashboard:$d[0],folderUid:"nychhc",overwrite:true}' \
    | curl -sk -u "$GAUTH" -H 'content-type: application/json' -X POST "$GURL/api/dashboards/db" -d @- >/dev/null \
    && ok "Grafana dashboard: $GURL/d/nychhc-workforce" || warn "Grafana dashboard import failed"
}

grafana_teardown() {
  local GURL GAUTH
  GURL="$(_grafana_url)"; GAUTH="$(_grafana_auth)"
  [[ -z "$GURL" ]] && return 0
  log "Grafana: remove NYCHHC dashboard + datasource + folder"
  curl -sk -u "$GAUTH" -X DELETE "$GURL/api/dashboards/uid/nychhc-workforce" >/dev/null 2>&1 || true
  curl -sk -u "$GAUTH" -X DELETE "$GURL/api/datasources/uid/nychhc-aurora" >/dev/null 2>&1 || true
  curl -sk -u "$GAUTH" -X DELETE "$GURL/api/folders/nychhc" >/dev/null 2>&1 || true
}

# ── Compute capacity: GPU + worker MachineSets the demo scales (guarded) ──────
# The demo runs on the platform's existing MachineSets. We scale a GPU set 0→1
# (granite vLLM needs an A10G) and a worker set up for CPU headroom — recording
# the ORIGINAL replica count so destroy.sh restores it exactly (GPU back to 0).
GPU_MACHINESET="${GPU_MACHINESET:-ai-demo-fs25h-gpu-demo-us-east-1a}"
WORKER_MACHINESET="${WORKER_MACHINESET:-ai-demo-fs25h-worker-us-east-1c}"
WORKER_REPLICAS="${WORKER_REPLICAS:-3}"
ANN_PREV="nychhc-demo.iisl.com/prev-replicas"
ANN_BY="nychhc-demo.iisl.com/scaled-up-by"

_scale_ms_up() {   # name desired — annotate prev-replicas (once) + scale up if needed
  local name="$1" want="$2" cur prev
  cur="$(oc -n openshift-machine-api get machineset "$name" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "")"
  [[ -z "$cur" ]] && { warn "MachineSet $name not found — skipping (set GPU_MACHINESET/WORKER_MACHINESET)"; return 0; }
  if (( cur < want )); then
    prev="$(oc -n openshift-machine-api get machineset "$name" -o jsonpath="{.metadata.annotations.${ANN_PREV//./\\.}}" 2>/dev/null || echo "")"
    [[ -z "$prev" ]] && oc -n openshift-machine-api annotate machineset "$name" "${ANN_PREV}=${cur}" --overwrite >/dev/null
    oc -n openshift-machine-api annotate machineset "$name" "${ANN_BY}=nychhc-demo" --overwrite >/dev/null
    log "Scaling MachineSet $name $cur → $want"
    oc -n openshift-machine-api scale machineset "$name" --replicas="$want" >/dev/null
  else
    ok "MachineSet $name already at $cur (>= $want)"
  fi
}

cluster_scale_up() {
  log "Ensure compute capacity (GPU + worker)"
  _scale_ms_up "$WORKER_MACHINESET" "$WORKER_REPLICAS"
  _scale_ms_up "$GPU_MACHINESET" 1
}

wait_for_gpu() {
  log "Wait for a GPU node to expose nvidia.com/gpu (up to ~12 min)"
  local i
  for i in $(seq 1 72); do
    if oc get nodes -o jsonpath='{range .items[*]}{.status.allocatable.nvidia\.com/gpu}{"\n"}{end}' 2>/dev/null | grep -qE '^[1-9]'; then
      ok "GPU node ready"; return 0
    fi
    sleep 10
  done
  warn "No allocatable GPU yet — granite IS may stay Pending. Check the GPU MachineSet + NVIDIA driver."
}

# ── KServe S3 pull creds: long-lived IAM user (storage-init can't use STS) ────
ensure_s3_creds() {
  local U=nychhc-demo-s3-rw CRED AK SK
  if ! aws iam get-user --user-name "$U" --profile "$AWS_PROFILE" >/dev/null 2>&1; then
    log "Create IAM user $U (read-only, models/nychhc/* only)"
    aws iam create-user --user-name "$U" --profile "$AWS_PROFILE" >/dev/null
  fi
  aws iam put-user-policy --user-name "$U" --policy-name s3-models-read --profile "$AWS_PROFILE" \
    --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::ai-demo-data-lake","Condition":{"StringLike":{"s3:prefix":["models/nychhc/*"]}}},{"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::ai-demo-data-lake/models/nychhc/*"}]}' >/dev/null
  if ! oc -n "$NS" get secret nychhc-s3-creds >/dev/null 2>&1; then
    # Clear stale keys (max 2/user) so create-access-key never fails, then mint one.
    for k in $(aws iam list-access-keys --user-name "$U" --profile "$AWS_PROFILE" --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null); do
      aws iam delete-access-key --user-name "$U" --access-key-id "$k" --profile "$AWS_PROFILE" 2>/dev/null || true; done
    CRED="$(aws iam create-access-key --user-name "$U" --profile "$AWS_PROFILE" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)"
    AK="$(echo "$CRED" | awk '{print $1}')"; SK="$(echo "$CRED" | awk '{print $2}')"
    log "Create secret nychhc-s3-creds + link to SA nychhc-copilot-sa"
    oc -n "$NS" create secret generic nychhc-s3-creds \
      --from-literal=AWS_ACCESS_KEY_ID="$AK" --from-literal=AWS_SECRET_ACCESS_KEY="$SK" \
      --dry-run=client -o yaml | oc apply -f - >/dev/null
    oc -n "$NS" annotate secret nychhc-s3-creds \
      serving.kserve.io/s3-endpoint=s3.us-east-1.amazonaws.com \
      serving.kserve.io/s3-region=us-east-1 \
      serving.kserve.io/s3-usehttps=1 serving.kserve.io/s3-verifyssl=1 --overwrite >/dev/null
    sleep 8   # let the new IAM key propagate before KServe uses it
  else
    ok "Secret nychhc-s3-creds already present"
  fi
  # SA must exist (gitops manifest 10) so the storage-initializer mounts the creds.
  oc -n "$NS" apply -f "$DEMO_DIR/gitops/manifests/10-serviceaccount.yaml" >/dev/null 2>&1 || true
  oc -n "$NS" secrets link nychhc-copilot-sa nychhc-s3-creds 2>/dev/null || true
}

# ── In-cluster build of the sklearn predictor image (KServe nychhc-sklearn rt) ─
build_sklearn_runtime() {
  log "In-cluster build: sklearn predictor (nychhc/copilot:sklearn)"
  oc -n "$NS" apply -f "$DEMO_DIR/build/sklearn-buildconfig.yaml" >/dev/null
  oc -n "$NS" start-build nychhc-sklearn --from-dir="$DEMO_DIR/models/serving" --follow \
    || warn "sklearn predictor build failed — noshow/forecast IS will not be Ready"
}
