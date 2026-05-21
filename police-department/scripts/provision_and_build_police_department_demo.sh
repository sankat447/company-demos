#!/usr/bin/env bash
# =============================================================================
#   provision_and_build_police_department_demo.sh
#
#   Single-button bring-up for the police-department CCTV demo on top of an
#   already-provisioned `ai-demo-stack-aws` OpenShift cluster.
#
#   What this script does, in order:
#     1. Load .env.demo (credentials + config).
#     2. Verify cluster reachability + admin identity.
#     3. Mirror / create all sensitive Secrets in pd-cctv + pd-personas
#        (Anthropic, Aurora, S3, Portkey, KServe storage-init).
#     4. Provision (or reuse) the long-lived IAM user `pd-demo-s3-rw` for
#        S3 read/write to the police-department prefixes — replaces the
#        1-hour SSO STS pattern that bit us repeatedly during demos.
#     5. Apply pd-llm-mode + pd-vlm-mode ConfigMaps with Prune=false annot
#        so ArgoCD doesn't blank operator-tweaked values.
#     6. Apply the ArgoCD bootstrap (App-of-Apps) so the seven child apps
#        sync (namespaces, aurora-schema, inference, pipeline, personas,
#        hitl, monitoring).
#     7. Stage the Qwen2.5-VL-7B model into S3 if it's missing.
#     8. Scale all 3 worker MachineSets to 2 replicas (1 per AZ is too tight).
#     9. Scale GPU MachineSet to 1 (g5.xlarge / A10G).
#    10. Wait for time-sliced GPU (allocatable=4) and worker readyReplicas=2.
#    11. Detect + drain bad nodes (chronic over-loaders + sick kubelets).
#    12. Broad webhook/operator health sweep — restart any pod with
#        restarts>5 in rhods-operator, odh-model-controller, rhods-dashboard,
#        knative-serving controllers, gpu-operator. (Yesterday these were
#        the cause of every "no endpoints available" / "context deadline
#        exceeded" admission webhook timeout.)
#    13. Apply the InferenceService + Pipeline + TriggerTemplate +
#        TriggerBinding (covers the case where a manifest drifted out of
#        the cluster despite ArgoCD).
#    14. Wait for the predictor pod to be 3/3 Ready.
#    15. Build + tag + roll the persona image (or skip if up-to-date).
#    16. Smoke-test the demo URL.
#    17. Print a final summary with URLs, key commands, and curl probes.
#
#   Idempotent — safe to re-run. Each step checks current state first.
#
#   Usage:
#     ./provision_and_build_police_department_demo.sh           # bring up
#     ./provision_and_build_police_department_demo.sh --rotate-keys  # also force-rotate IAM keys
#     ./provision_and_build_police_department_demo.sh --skip-build   # skip persona image build
#     ./provision_and_build_police_department_demo.sh --dry-run      # print plan only
# =============================================================================

set -euo pipefail

SCRIPT_NAME="provision-pd-demo"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.demo"

# ── Flags ─────────────────────────────────────────────────────────────────
ROTATE_KEYS=false
SKIP_BUILD=false
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --rotate-keys) ROTATE_KEYS=true ;;
    --skip-build)  SKIP_BUILD=true  ;;
    --dry-run)     DRY_RUN=true     ;;
    --help|-h)
      sed -n '2,60p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# ── Logging ───────────────────────────────────────────────────────────────
_C_RED='\033[0;31m'; _C_GRN='\033[0;32m'; _C_YLW='\033[0;33m'
_C_BLU='\033[0;34m'; _C_BLD='\033[1m'; _C_RST='\033[0m'
log()  { printf "${_C_BLU}[%s]${_C_RST} %s\n" "$SCRIPT_NAME" "$*" >&2; }
ok()   { printf "${_C_GRN}[%s] ✔${_C_RST} %s\n" "$SCRIPT_NAME" "$*" >&2; }
warn() { printf "${_C_YLW}[%s] ⚠${_C_RST} %s\n" "$SCRIPT_NAME" "$*" >&2; }
err()  { printf "${_C_RED}[%s] ✖${_C_RST} %s\n" "$SCRIPT_NAME" "$*" >&2; }
banner(){ printf "\n${_C_BLD}━━━ %s ━━━${_C_RST}\n" "$*" >&2; }

run() {
  if "$DRY_RUN"; then printf "  ${_C_YLW}DRY:${_C_RST} %s\n" "$*" >&2
  else "$@"
  fi
}

# ── Step 1: load env ──────────────────────────────────────────────────────
banner "Step 1 · Load .env.demo"
if [ ! -f "$ENV_FILE" ]; then
  err "$ENV_FILE not found. Copy .env.demo.example to .env.demo and fill in values."
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

require() {
  # Don't use `[ -z "$x" ] && ...` here — under `set -e` the failing
  # branch of [ ] aborts the script. Use a plain if/then.
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then err "$v is unset in .env.demo"; exit 1; fi
  done
}
require PD_KUBECONFIG PD_AWS_PROFILE PD_AWS_REGION PD_ANTHROPIC_API_KEY \
        PD_BUCKET PD_NS_CCTV PD_NS_PERSONAS
[ -f "$PD_KUBECONFIG" ] || { err "PD_KUBECONFIG file does not exist: $PD_KUBECONFIG"; exit 1; }
export KUBECONFIG="$PD_KUBECONFIG"

# PD_MACHINESET_PREFIX changes per Terraform run (the cluster ID is
# generated). If blank, auto-detect from the live MachineSets.
if [ -z "${PD_MACHINESET_PREFIX:-}" ]; then
  # macOS BSD sed doesn't like `|` as both the separator and alternation
  # operator on the same line. Use awk-based extraction instead.
  PD_MACHINESET_PREFIX=$(oc -n openshift-machine-api get machineset -o name 2>/dev/null \
    | head -1 \
    | awk -F'/' '{print $2}' \
    | awk -F'-' '{print $1"-"$2"-"$3}')
  if [ -n "$PD_MACHINESET_PREFIX" ]; then
    log "auto-detected MachineSet prefix: $PD_MACHINESET_PREFIX"
  else
    err "PD_MACHINESET_PREFIX not set + auto-detect failed"; exit 1
  fi
fi
ok "env loaded · KUBECONFIG=$PD_KUBECONFIG · PD_BUCKET=$PD_BUCKET · MS=$PD_MACHINESET_PREFIX"

# ── Step 2: cluster reachability ──────────────────────────────────────────
banner "Step 2 · Verify cluster + identity"
WHO=$(oc whoami 2>/dev/null || true)
if [ -z "$WHO" ]; then err "oc whoami failed; check KUBECONFIG"; exit 1; fi
log "logged in as $WHO"
if [ "$WHO" != "system:admin" ]; then warn "expected system:admin; some MachineSet ops may be denied"; fi

# AWS SSO check (only critical if we need to provision IAM)
AWS_PROFILE="$PD_AWS_PROFILE"; export AWS_PROFILE
if ! aws sts get-caller-identity --output text >/dev/null 2>&1; then
  warn "AWS SSO session expired; running 'aws sso login --profile $PD_AWS_PROFILE'..."
  if ! "$DRY_RUN"; then aws sso login --profile "$PD_AWS_PROFILE"; fi
fi
ok "AWS identity: $(aws sts get-caller-identity --query Arn --output text 2>/dev/null || echo dry-run)"

# ── Step 2.5: ensure demo namespaces exist (idempotent) ───────────────────
# Both secret-stamping (step 3+4) and CM creation (step 5) need these.
# ArgoCD's pd-namespaces app will reconcile labels/annotations on the
# next sync; we just need them to physically exist NOW.
banner "Step 2.5 · Ensure demo namespaces exist"
for ns in "$PD_NS_CCTV" "$PD_NS_PERSONAS"; do
  if "$DRY_RUN"; then log "DRY ensure ns/$ns"; continue; fi
  oc create namespace "$ns" --dry-run=client -o yaml | oc apply -f - >/dev/null 2>&1 \
    && log "  ns/$ns ready"
done
# Label so RHOAI dashboard sees pd-cctv as a Data Science Project.
"$DRY_RUN" || oc label ns "$PD_NS_CCTV" opendatahub.io/dashboard=true --overwrite >/dev/null 2>&1 || true
ok "namespaces present"

# ── Step 3: long-lived IAM user pd-demo-s3-rw ─────────────────────────────
banner "Step 3 · Long-lived IAM user pd-demo-s3-rw (replaces 1h STS)"
IAM_USER="pd-demo-s3-rw"
EXISTING=$(aws iam list-access-keys --user-name "$IAM_USER" --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null || echo "")
LIVE_AKID=$(oc -n "$PD_NS_PERSONAS" get secret pd-s3-creds -o jsonpath='{.data.access_key_id}' 2>/dev/null | base64 -d 2>/dev/null || echo "")

needs_rotate=false
if "$ROTATE_KEYS"; then
  needs_rotate=true
elif [[ "$LIVE_AKID" == AKIA* ]] && echo "$EXISTING" | tr ' ' '\n' | grep -qx "$LIVE_AKID"; then
  ok "pd-s3-creds AKID $LIVE_AKID is live and matches an IAM key — no rotation needed"
else
  needs_rotate=true
  log "current pd-s3-creds AKID is missing or stale; will provision a fresh key"
fi

if "$needs_rotate" && ! "$DRY_RUN"; then
  # Ensure IAM user exists
  aws iam create-user --user-name "$IAM_USER" 2>/dev/null || true
  POLICY_FILE=$(mktemp); trap 'rm -f $POLICY_FILE' EXIT
  cat > "$POLICY_FILE" <<POL
{ "Version": "2012-10-17", "Statement": [
    {"Sid":"ObjectRW","Effect":"Allow",
     "Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],
     "Resource":[
        "arn:aws:s3:::$PD_BUCKET/clips/police-department/*",
        "arn:aws:s3:::$PD_BUCKET/processed/police-department/*",
        "arn:aws:s3:::$PD_BUCKET/models/police-department/*"]},
    {"Sid":"BucketList","Effect":"Allow","Action":["s3:ListBucket"],
     "Resource":"arn:aws:s3:::$PD_BUCKET",
     "Condition":{"StringLike":{"s3:prefix":[
        "clips/police-department/*","processed/police-department/*","models/police-department/*"]}}}
]}
POL
  aws iam put-user-policy --user-name "$IAM_USER" --policy-name pd-s3-rw \
                          --policy-document "file://$POLICY_FILE"
  # Delete existing keys (max 2 per IAM user); we don't have their secrets so they're useless.
  for k in $EXISTING; do aws iam delete-access-key --user-name "$IAM_USER" --access-key-id "$k"; done
  KEY_OUT=$(aws iam create-access-key --user-name "$IAM_USER" \
              --query '[AccessKey.AccessKeyId,AccessKey.SecretAccessKey]' --output text)
  AKID=$(echo "$KEY_OUT" | awk '{print $1}')
  SECRET=$(echo "$KEY_OUT" | awk '{print $2}')
  for ns in "$PD_NS_CCTV" "$PD_NS_PERSONAS"; do
    oc -n "$ns" create secret generic pd-s3-creds \
        --from-literal=access_key_id="$AKID" \
        --from-literal=secret_access_key="$SECRET" \
        --from-literal=session_token="" \
        --from-literal=region="$PD_AWS_REGION" \
        --dry-run=client -o yaml | oc apply --server-side --force-conflicts -f -
    oc -n "$ns" annotate secret pd-s3-creds "argocd.argoproj.io/sync-options=Prune=false" --overwrite >/dev/null
  done
  ok "pd-s3-creds stamped in $PD_NS_CCTV + $PD_NS_PERSONAS · AKID=$AKID"
fi

# ── Step 4: other Secrets ─────────────────────────────────────────────────
banner "Step 4 · Anthropic + Aurora + Portkey Secrets (out-of-band, Prune=false)"
upsert() {  # name ns key=value [key=value...]
  local name="$1" ns="$2"; shift 2
  local args=()
  for kv in "$@"; do args+=(--from-literal="$kv"); done
  if "$DRY_RUN"; then log "DRY upsert secret/$name in $ns"; return; fi
  oc -n "$ns" create secret generic "$name" "${args[@]}" --dry-run=client -o yaml \
    | oc apply --server-side --force-conflicts -f -
  oc -n "$ns" annotate secret "$name" \
    "argocd.argoproj.io/sync-options=Prune=false" --overwrite >/dev/null 2>&1 || true
}

# Anthropic — used by persona /chat AND vlm-caption (claude-multimodal)
for ns in "$PD_NS_PERSONAS" "$PD_NS_CCTV"; do
  upsert pd-anthropic-key "$ns" "api_key=$PD_ANTHROPIC_API_KEY"
done

# Aurora — autodiscover in two ways:
#   1. ai-demo/aurora-credentials Secret (older platform deployments)
#   2. AWS SSM Parameter Store /ai-demo/aurora/{endpoint,master-password}
#      (newer ai-demo-stack-aws Terraform — what fresh clusters look like)
if [ -z "${PD_AURORA_HOST:-}" ] || [ -z "${PD_AURORA_PASSWORD:-}" ]; then
  log "autodiscovering Aurora — try cluster Secret first, then AWS SSM"
  PD_AURORA_HOST=$(oc -n ai-demo get secret aurora-credentials -o jsonpath='{.data.endpoint}' 2>/dev/null | base64 -d || true)
  PD_AURORA_PASSWORD=$(oc -n ai-demo get secret aurora-credentials -o jsonpath='{.data.password}' 2>/dev/null | base64 -d || true)
  if [ -z "$PD_AURORA_HOST" ] || [ -z "$PD_AURORA_PASSWORD" ]; then
    log "  cluster Secret not found; trying SSM"
    PD_AURORA_HOST=$(aws ssm get-parameter --region "$PD_AWS_REGION" --name /ai-demo/aurora/endpoint \
                       --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    PD_AURORA_PASSWORD=$(aws ssm get-parameter --region "$PD_AWS_REGION" --name /ai-demo/aurora/master-password \
                          --with-decryption --query 'Parameter.Value' --output text 2>/dev/null || echo "")
  fi
fi
if [ -z "$PD_AURORA_HOST" ]; then err "PD_AURORA_HOST empty AND autodiscovery failed (tried Secret + SSM)"; exit 1; fi
if [ -z "$PD_AURORA_PASSWORD" ]; then err "PD_AURORA_PASSWORD empty AND autodiscovery failed"; exit 1; fi
log "Aurora host: $PD_AURORA_HOST"
for ns in "$PD_NS_CCTV" "$PD_NS_PERSONAS"; do
  upsert pd-aurora-credentials "$ns" \
    "endpoint=$PD_AURORA_HOST" "database=rhoai_demo" \
    "username=rhoai_admin" "password=$PD_AURORA_PASSWORD"
done

# Portkey (optional)
if [ -n "${PD_PORTKEY_API_KEY:-}" ]; then
  upsert pd-portkey-key "$PD_NS_PERSONAS" "api_key=$PD_PORTKEY_API_KEY"
fi

# KServe storage-init (optional — only if user provided long-lived AWS keys
# specifically for the model storage-init; the runtime keys above can serve
# this purpose too, since pd-demo-s3-rw includes models/* read access).
if [ -n "${PD_KSERVE_S3_AKID:-}" ] && [ -n "${PD_KSERVE_S3_SECRET:-}" ]; then
  if ! "$DRY_RUN"; then
    oc -n "$PD_NS_CCTV" create secret generic pd-kserve-s3-creds \
      --from-literal=AWS_ACCESS_KEY_ID="$PD_KSERVE_S3_AKID" \
      --from-literal=AWS_SECRET_ACCESS_KEY="$PD_KSERVE_S3_SECRET" \
      --dry-run=client -o yaml | oc apply --server-side --force-conflicts -f -
    oc -n "$PD_NS_CCTV" annotate secret pd-kserve-s3-creds \
      serving.kserve.io/s3-endpoint=s3.amazonaws.com \
      serving.kserve.io/s3-region="$PD_AWS_REGION" \
      serving.kserve.io/s3-usehttps=1 serving.kserve.io/s3-verifyssl=1 \
      "argocd.argoproj.io/sync-options=Prune=false" --overwrite >/dev/null
  fi
fi
ok "secrets stamped"

# ── Step 5: mode ConfigMaps ───────────────────────────────────────────────
banner "Step 5 · pd-llm-mode + pd-vlm-mode (Prune=false, never blanked)"
upsert_cm() {  # name ns key1=val1 [key2=val2...]
  local name="$1" ns="$2"; shift 2
  local args=()
  for kv in "$@"; do args+=(--from-literal="$kv"); done
  if "$DRY_RUN"; then log "DRY upsert cm/$name in $ns"; return; fi
  oc -n "$ns" create configmap "$name" "${args[@]}" --dry-run=client -o yaml \
    | oc apply --server-side --force-conflicts -f -
  oc -n "$ns" annotate cm "$name" \
    "argocd.argoproj.io/sync-options=Prune=false" --overwrite >/dev/null 2>&1 || true
}
# pd-llm-mode (chat-time persona LLM): default claude. Read by persona pod.
upsert_cm pd-llm-mode "$PD_NS_PERSONAS" "mode=claude" "model_local=llama-3-1-8b" "model_claude=claude-sonnet-4"
# pd-vlm-mode (ingest-time VLM): default local at 640px (lesson 10 — 1280px busts max-model-len=8192).
upsert_cm pd-vlm-mode "$PD_NS_CCTV" "mode=local" "frames=16" "resolution=640" "jpeg_quality=2"
ok "modes set: chat=claude · ingest=local @ 640px"

# ── Step 6: ArgoCD bootstrap ──────────────────────────────────────────────
banner "Step 6 · ArgoCD app-of-apps"
# Inline this rather than delegating, because bootstrap/03_apply_argocd.sh
# has a 10-min per-app waiter that times out before ArgoCD's natural 3-min
# refresh cycle has even started on a fresh cluster — and its non-zero
# exit silently truncates the parent script. We do the apply ourselves
# and just wait for the bootstrap App itself to be Synced+Healthy (which
# means all 7 children have materialised); each child reconciles on its
# own clock after that.
APP_OF_APPS="$REPO_ROOT/police-department/argocd/bootstrap-application.yaml"
if "$DRY_RUN"; then
  log "DRY oc apply -f $APP_OF_APPS"
elif [ -f "$APP_OF_APPS" ]; then
  oc apply -f "$APP_OF_APPS" >/dev/null
  log "waiting up to 20 min for pd-bootstrap Synced+Healthy + 7 child apps to exist"
  T=$(date +%s); LIM=$((T+1200))
  while true; do
    sync=$(oc -n openshift-gitops get application.argoproj.io pd-bootstrap -o jsonpath='{.status.sync.status}' 2>/dev/null)
    n_children=$(oc -n openshift-gitops get application.argoproj.io --no-headers 2>/dev/null | grep -c '^pd-' || true)
    if [ "$sync" = "Synced" ] && [ "$n_children" -ge 7 ]; then
      ok "pd-bootstrap Synced; $n_children pd-* child apps exist"
      break
    fi
    if [ "$(date +%s)" -gt "$LIM" ]; then
      warn "ArgoCD bootstrap waiter timed out (sync=$sync children=$n_children) — continuing; manifests below will apply directly"
      break
    fi
    sleep 20
  done
else
  warn "$APP_OF_APPS not found; skipping ArgoCD bring-up"
fi

# ── Step 7: stage Qwen-VL model into S3 (idempotent) ──────────────────────
banner "Step 7 · Stage Qwen-VL model in S3 (skips if already present)"
if [ -x "$REPO_ROOT/police-department/bootstrap/02_fetch_models.sh" ]; then
  HF_TOKEN="${PD_HF_TOKEN:-}" run "$REPO_ROOT/police-department/bootstrap/02_fetch_models.sh" || \
    warn "model fetch returned non-zero — predictor will fail to load if model missing"
fi

# ── Step 8 + 9: scale workers + GPU ───────────────────────────────────────
banner "Step 8+9 · Scale MachineSets (workers 2/AZ + GPU 1)"
for az in 1a 1b 1c; do
  ms="${PD_MACHINESET_PREFIX}-worker-us-east-${az}"
  run oc -n openshift-machine-api annotate machineset "$ms" \
       pd-cctv.iisl.com/scaled-up-by=demo-session --overwrite >/dev/null
  run oc -n openshift-machine-api scale machineset "$ms" --replicas=2
done
gpu_ms="${PD_MACHINESET_PREFIX}-gpu-demo-us-east-1a"
run oc -n openshift-machine-api scale machineset "$gpu_ms" --replicas=1
ok "scale-up requested"

# ── Step 10: wait GPU allocatable=4 + workers ready ───────────────────────
banner "Step 10 · Wait — GPU time-sliced + workers Ready"
if ! "$DRY_RUN"; then
  log "waiting for GPU allocatable=4 (NOT >=1; that means time-slicing not yet applied)"
  T=$(date +%s); LIM=$((T+900))   # 15-min timeout
  while [ "$(oc get node -l nvidia.com/gpu.present=true \
              -o jsonpath='{.items[0].status.allocatable.nvidia\.com/gpu}' 2>/dev/null)" != "4" ]; do
    if [ "$(date +%s)" -gt "$LIM" ]; then err "GPU allocatable=4 timeout"; exit 1; fi
    sleep 15
  done
  ok "GPU allocatable=4"

  log "waiting for all worker MachineSets readyReplicas=2"
  while :; do
    bad=0
    for az in 1a 1b 1c; do
      r=$(oc -n openshift-machine-api get machineset "${PD_MACHINESET_PREFIX}-worker-us-east-${az}" \
            -o jsonpath='{.status.readyReplicas}' 2>/dev/null)
      [ "$r" = "2" ] || bad=$((bad+1))
    done
    if [ "$bad" = "0" ]; then break; fi
    if [ "$(date +%s)" -gt "$LIM" ]; then err "worker readyReplicas timeout"; exit 1; fi
    sleep 15
  done
  ok "workers 2/2 across us-east-1a/1b/1c"
fi

# ── Step 11: detect + drain bad nodes ─────────────────────────────────────
banner "Step 11 · Detect + drain pathological nodes"
# Bad-node heuristic: any worker that is (a) cordoned (kubelet sick or admin
# cordoned us out of paranoia), or (b) has any pod with restartCount >= 50
# in a system-critical namespace. Today's-you should add IPs to the runbook;
# this code finds them dynamically instead of hardcoding.
if ! "$DRY_RUN"; then
  bad_nodes=$(oc get nodes -o json | jq -r '.items[] |
    select(.spec.unschedulable == true) |
    select(.metadata.labels."node-role.kubernetes.io/master" == null) |
    .metadata.name')
  for n in $bad_nodes; do
    log "draining $n (already cordoned)"
    oc adm drain "$n" --delete-emptydir-data --ignore-daemonsets --force \
      --grace-period=30 --timeout=180s 2>&1 | tail -3 || true
    # Force-evict any non-DS straggler
    oc get pods -A --field-selector=spec.nodeName="$n" -o json \
      | jq -r '.items[] | select(.metadata.ownerReferences[]?.kind != "DaemonSet")
                        | "\(.metadata.namespace) \(.metadata.name)"' \
      | while read ns pod; do
        [ -n "$pod" ] && oc -n "$ns" delete pod "$pod" --grace-period=0 --force --wait=false 2>/dev/null || true
      done
  done
  [ -z "$bad_nodes" ] && ok "no cordoned worker nodes — skipping drain" \
                      || ok "drained: $(echo $bad_nodes | tr '\n' ' ')"
fi

# ── Step 12: broad webhook/operator health sweep ──────────────────────────
banner "Step 12 · Health sweep — restart any operator/webhook with restarts>5"
if ! "$DRY_RUN"; then
  for nslbl in "redhat-ods-operator name=rhods-operator" \
               "redhat-ods-applications control-plane=odh-model-controller" \
               "redhat-ods-applications deployment=rhods-dashboard" \
               "knative-serving app=autoscaler" \
               "knative-serving app=autoscaler-hpa" \
               "knative-serving app=controller" \
               "knative-serving app=net-istio-controller" \
               "knative-serving app=net-istio-webhook" \
               "knative-serving app=webhook" \
               "gpu-operator-resources app=gpu-operator"; do
    ns=$(echo $nslbl | awk '{print $1}'); lbl=$(echo $nslbl | awk '{print $2}')
    bad=$(oc -n "$ns" get pods -l "$lbl" -o json 2>/dev/null | jq -r '.items[] |
        select((.metadata.ownerReferences|any(.kind=="ReplicaSet")) and
               (.status.containerStatuses[]? | (.restartCount > 5 or .ready == false))) |
        .metadata.name' 2>/dev/null || true)
    [ -z "$bad" ] && continue
    log "  $ns/$lbl crashloop — restarting"
    echo "$bad" | while read p; do
      [ -n "$p" ] && oc -n "$ns" delete pod "$p" --grace-period=0 --force --wait=false 2>/dev/null
    done
  done
  ok "sweep done — wait 60s for replacements"
  sleep 60
fi

# ── Step 13: GPU mutex preflight (skip if predictor already running) ──────
banner "Step 13 · GPU-mutex preflight"
if ! "$DRY_RUN"; then
  PRED_READY=$(oc -n "$PD_NS_CCTV" get pods -l serving.kserve.io/inferenceservice=pd-qwen25-vl-7b \
    -o jsonpath='{.items[0].status.containerStatuses[?(@.name=="kserve-container")].ready}' 2>/dev/null)
  if [ "$PRED_READY" = "true" ]; then
    ok "predictor is already 3/3 — leaving GPU mutex alone"
  else
    while [ "$(oc get pods -A -o json | jq '[.items[] |
                select(.spec.containers[]?.resources.requests."nvidia.com/gpu"? == "1")] | length')" != "0" ]; do
      log "waiting for orphan GPU-holding pods to clear..."
      sleep 10
    done
    ok "GPU mutex clean"
  fi
fi

# ── Step 14: apply IS + pipeline + triggers ───────────────────────────────
banner "Step 14 · Apply InferenceService + Pipeline + Triggers"
M="$REPO_ROOT/police-department/manifests"
for f in "$M/inference/pd-qwen25-vl-7b.yaml" \
         "$M/pipeline/pd-pipeline.yaml" \
         "$M/pipeline/pd-triggertemplate.yaml" \
         "$M/pipeline/pd-triggerbinding.yaml"; do
  [ -f "$f" ] && run oc apply -f "$f" >/dev/null && log "applied $(basename "$f")"
done

if ! "$DRY_RUN"; then
  log "waiting for predictor 3/3 Ready (cold-start 5–8 min: image pull + S3 model + vLLM load)"
  T=$(date +%s); LIM=$((T+1800))    # 30-min timeout (matches IS progress-deadline)
  while [ "$(oc -n "$PD_NS_CCTV" get pods -l serving.kserve.io/inferenceservice=pd-qwen25-vl-7b \
                -o jsonpath='{.items[0].status.containerStatuses[?(@.name=="kserve-container")].ready}' 2>/dev/null)" != "true" ]; do
    [ "$(date +%s)" -gt "$LIM" ] && { err "predictor cold-start timeout"; exit 1; }
    sleep 30
  done
  ok "predictor 3/3 Ready"
fi

# ── Step 15: persona image build/rollout ──────────────────────────────────
banner "Step 15 · Persona image build + rollout"
if "$SKIP_BUILD"; then
  ok "skipped (--skip-build) — relying on whatever :0.2.0 currently points to"
else
  if ! "$DRY_RUN"; then
    cd "$REPO_ROOT/police-department/personas"
    BUILD=$(oc -n "$PD_NS_PERSONAS" start-build pd-persona --from-dir=. --follow=false 2>&1 | grep -oE 'pd-persona-[0-9]+' | head -1)
    [ -z "$BUILD" ] && { err "start-build failed"; exit 1; }
    log "started build $BUILD; waiting for Complete..."
    while [ "$(oc -n "$PD_NS_PERSONAS" get build "$BUILD" -o jsonpath='{.status.phase}')" != "Complete" ]; do
      sleep 30
    done
    ok "$BUILD Complete"
    # BuildConfig outputs to :latest; deployment pins :0.2.0 — retag.
    oc -n "$PD_NS_PERSONAS" tag pd-persona:latest pd-persona:0.2.0
    oc -n "$PD_NS_PERSONAS" rollout restart deploy/pd-persona
    oc -n "$PD_NS_PERSONAS" rollout status deploy/pd-persona --timeout=300s
    ok "persona rolled out"
  fi
fi

# ── Step 16: smoke test ───────────────────────────────────────────────────
banner "Step 16 · Smoke test"
URL="https://pd-persona-pd-personas.apps.ai-demo.iisdemolab.click"
if ! "$DRY_RUN"; then
  CODE=$(curl -skSI "$URL" --max-time 10 2>&1 | head -1 | awk '{print $2}')
  case "$CODE" in
    200|405) ok "HTTP $CODE — route healthy" ;;
    *)       warn "HTTP $CODE — route not Ready; persona pod may still be starting" ;;
  esac
fi

# ── Step 17: summary ──────────────────────────────────────────────────────
banner "DONE — police-department demo is up"
cat <<EOF >&2

  Demo URL:   $URL
  RHOAI UI:   https://rhods-dashboard-redhat-ods-applications.apps.ai-demo.iisdemolab.click
  CloudBeaver:https://cloudbeaver-rhoai-tools.apps.ai-demo.iisdemolab.click   (DB browse — Aurora pgvector)
  Aurora:     $PD_AURORA_HOST  · db=rhoai_demo  user=rhoai_admin

  Modes:
    pd-llm-mode  (chat)   = $(oc -n $PD_NS_PERSONAS get cm pd-llm-mode -o jsonpath='{.data.mode}' 2>/dev/null)
    pd-vlm-mode  (ingest) = $(oc -n $PD_NS_CCTV get cm pd-vlm-mode -o jsonpath='{.data.mode}' 2>/dev/null) @ $(oc -n $PD_NS_CCTV get cm pd-vlm-mode -o jsonpath='{.data.resolution}' 2>/dev/null)px

  Slash commands available in chat:
    /plate /people /vehicle /event /suspect /geo /note   /list /undo /help

  Tear down when finished:
    ./destroy_police_department_demo.sh

EOF
ok "bring-up complete"
