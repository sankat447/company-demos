#!/usr/bin/env bash
# =============================================================================
#   destroy_police_department_demo.sh
#
#   Safe teardown of everything the demo provisions, in dependency order.
#   The platform `ai-demo-stack-aws` cluster is left UNTOUCHED — only demo
#   artefacts in pd-cctv, pd-personas, and the demo's S3 / Aurora prefixes
#   are removed.
#
#   Steps:
#     1. Wipe Aurora rows (pd_cctv schema; preserve sentinel clip).
#     2. Empty S3 prefixes clips/police-department/ + processed/police-department/
#        (preserve _sentinel.mp4 for empty-state UI).
#     3. Empty EFS workspace clip dirs (preserve .cache for warm models).
#     4. Cancel in-flight PipelineRuns + TaskRuns.
#     5. Delete InferenceService + Knative Service / Configuration / Revision residue.
#     6. Scale GPU MachineSet back to 0.
#     7. Scale worker MachineSets back to 1 per AZ (baseline).
#     8. (--hard) Delete pd-anthropic-key + pd-aurora-credentials Secrets.
#     9. (--hard) Delete the IAM user pd-demo-s3-rw and its bucket policy.
#    10. (--hard) Delete the bootstrap ArgoCD Application — cascades to all
#                 child apps (pd-namespaces, pd-aurora-schema, pd-inference,
#                 pd-pipeline, pd-personas, pd-hitl, pd-monitoring).
#                 This will force a full re-bring-up next time.
#
#   Default mode is SOFT — keeps the persona pod, the IAM user, and the
#   ArgoCD apps in place so the next bring-up is a quick re-scale. Pass
#   --hard to remove everything including the IAM user.
#
#   Usage:
#     ./destroy_police_department_demo.sh             # soft teardown (default)
#     ./destroy_police_department_demo.sh --hard      # also remove IAM user + ArgoCD apps
#     ./destroy_police_department_demo.sh --dry-run   # print plan only
# =============================================================================

set -euo pipefail

SCRIPT_NAME="destroy-pd-demo"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.demo"

HARD=false
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --hard)    HARD=true ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h) sed -n '2,40p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

_C_RED='\033[0;31m'; _C_GRN='\033[0;32m'; _C_YLW='\033[0;33m'
_C_BLU='\033[0;34m'; _C_BLD='\033[1m'; _C_RST='\033[0m'
log()  { printf "${_C_BLU}[%s]${_C_RST} %s\n" "$SCRIPT_NAME" "$*" >&2; }
ok()   { printf "${_C_GRN}[%s] ✔${_C_RST} %s\n" "$SCRIPT_NAME" "$*" >&2; }
warn() { printf "${_C_YLW}[%s] ⚠${_C_RST} %s\n" "$SCRIPT_NAME" "$*" >&2; }
err()  { printf "${_C_RED}[%s] ✖${_C_RST} %s\n" "$SCRIPT_NAME" "$*" >&2; }
banner(){ printf "\n${_C_BLD}━━━ %s ━━━${_C_RST}\n" "$*" >&2; }

run() { if "$DRY_RUN"; then printf "  ${_C_YLW}DRY:${_C_RST} %s\n" "$*" >&2; else "$@" || true; fi; }

# ── env ───────────────────────────────────────────────────────────────────
[ ! -f "$ENV_FILE" ] && { err "$ENV_FILE missing — copy .env.demo.example first"; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
export KUBECONFIG="$PD_KUBECONFIG"
oc whoami >/dev/null || { err "oc whoami failed"; exit 1; }

# MachineSet prefix auto-detect (lesson 17.17 — destroy script used to swallow
# the empty prefix and pass `-gpu-demo-us-east-1a` to oc scale, which then
# parsed it as a shorthand flag `-g`). Real names look like
# `ai-demo-zpvwj-gpu-demo-us-east-1a` → prefix is the first 3 dash-fields.
if [ -z "${PD_MACHINESET_PREFIX:-}" ]; then
  # First attempt (lesson 17.17 v1) used `awk -F-` to peel off "-<role>-us-east-<az>",
  # but the role field-count varies (worker=1, gpu-demo=2, compute=1), so we ended
  # up with `ai-demo-zpvwj-compute` on a cluster whose compute MachineSet sorted
  # first. v2: pin on the deterministic `<prefix>-worker-us-east-1a` name.
  WORKER_MS=$(oc -n openshift-machine-api get machineset -o name 2>/dev/null \
    | awk -F'/' '{print $2}' | grep -E -- '-worker-us-east-1a$' | head -1)
  PD_MACHINESET_PREFIX="${WORKER_MS%-worker-us-east-1a}"
fi
if [ -z "$PD_MACHINESET_PREFIX" ]; then
  err "PD_MACHINESET_PREFIX could not be auto-detected — set it explicitly in .env.demo"
  exit 1
fi

log "kubeconfig=$PD_KUBECONFIG · ns=($PD_NS_CCTV,$PD_NS_PERSONAS) · bucket=$PD_BUCKET · ms-prefix=$PD_MACHINESET_PREFIX"
"$HARD" && warn "HARD mode — will also delete IAM user + bootstrap Application"

# ── Step 1: wipe Aurora rows (preserve sentinel) ──────────────────────────
banner "Step 1 · Aurora wipe (sentinel preserved)"
SENTINEL='00000000-0000-0000-0000-000000000001'
POD=$(oc -n "$PD_NS_PERSONAS" get pods -l app.kubernetes.io/name=pd-persona \
        --no-headers --field-selector=status.phase=Running 2>/dev/null | head -1 | awk '{print $1}')
if [ -n "$POD" ] && ! "$DRY_RUN"; then
  oc -n "$PD_NS_PERSONAS" exec "$POD" -c pd-persona -- python3 -c "
import os, psycopg
S='$SENTINEL'
with psycopg.connect(host=os.environ['PGHOST'], dbname=os.environ['PGDATABASE'],
                     user=os.environ['PGUSER'], password=os.environ['PGPASSWORD']) as c:
    cur=c.cursor()
    # custody_log has an append-only trigger — TRUNCATE bypasses it.
    cur.execute('TRUNCATE pd_cctv.custody_log;')
    # operator_corrections may not exist on a fresh cluster — guard.
    cur.execute(\"SELECT to_regclass('pd_cctv.operator_corrections') IS NOT NULL\")
    has_oc = cur.fetchone()[0]
    if has_oc:
        cur.execute('TRUNCATE pd_cctv.faces, pd_cctv.plates, pd_cctv.events, pd_cctv.narrations, pd_cctv.relationships, pd_cctv.entities, pd_cctv.operator_corrections;')
    else:
        cur.execute('TRUNCATE pd_cctv.faces, pd_cctv.plates, pd_cctv.events, pd_cctv.narrations, pd_cctv.relationships, pd_cctv.entities;')
    cur.execute('DELETE FROM pd_cctv.clips WHERE clip_id::text != %s;', (S,))
    c.commit()
    for t in ('clips','narrations','plates','faces','custody_log'):
        cur.execute(f'SELECT count(*) FROM pd_cctv.{t}')
        print(f'  {t}:', cur.fetchone()[0])
" 2>&1 | head -10
  ok "Aurora rows wiped"
else
  warn "no Running persona pod — Aurora wipe skipped (run again after persona is back, or bring up first)"
fi

# ── Step 2: S3 wipe via the in-cluster long-lived IAM ─────────────────────
banner "Step 2 · S3 wipe (sentinel preserved)"
if [ -n "$POD" ] && ! "$DRY_RUN"; then
  oc -n "$PD_NS_PERSONAS" exec "$POD" -c pd-persona -- python3 -c "
import os, boto3
s3 = boto3.client('s3',
    aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'])
b = '$PD_BUCKET'
for prefix in ('clips/police-department/', 'processed/police-department/'):
    pag = s3.get_paginator('list_objects_v2')
    n = 0
    for page in pag.paginate(Bucket=b, Prefix=prefix):
        for o in (page.get('Contents') or []):
            if o['Key'].endswith('_sentinel.mp4'): continue
            s3.delete_object(Bucket=b, Key=o['Key']); n += 1
    print(f'  {prefix}: deleted {n}')
" 2>&1 | head -5
  ok "S3 prefixes empty (sentinel kept)"
fi

# ── Step 3: EFS workspace clip dirs ───────────────────────────────────────
banner "Step 3 · EFS workspace clip dirs (preserve .cache)"
if ! "$DRY_RUN"; then
  cat <<'EOF' | oc -n "$PD_NS_CCTV" apply -f - >/dev/null 2>&1 || true
apiVersion: v1
kind: Pod
metadata: { name: ws-cleanup }
spec:
  restartPolicy: Never
  containers:
  - name: c
    image: registry.access.redhat.com/ubi9/ubi-minimal:latest
    command: ["/bin/sh","-c"]
    args:
    - |
      cd /shared
      n=0
      for d in */; do
        d="${d%/}"
        case "$d" in .cache|lost+found|''|.|..) continue;; esac
        rm -rf "$d"; n=$((n+1))
      done
      echo "purged $n; kept:"; ls -1
    volumeMounts: [ { name: ws, mountPath: /shared } ]
  volumes:
  - name: ws
    persistentVolumeClaim: { claimName: pd-pipeline-workspace }
EOF
  T=$(date +%s); LIM=$((T+120))
  while [ "$(oc -n "$PD_NS_CCTV" get pod ws-cleanup -o jsonpath='{.status.phase}' 2>/dev/null)" != "Succeeded" ]; do
    [ "$(date +%s)" -gt "$LIM" ] && break
    sleep 3
  done
  oc -n "$PD_NS_CCTV" logs ws-cleanup 2>&1 | head -3 || true
  oc -n "$PD_NS_CCTV" delete pod ws-cleanup --wait=false >/dev/null 2>&1 || true
fi

# ── Step 4: cancel pipeline runs ──────────────────────────────────────────
banner "Step 4 · Cancel PipelineRuns + TaskRuns"
run oc -n "$PD_NS_CCTV" delete pipelineruns --all --wait=false 2>&1 | tail -2
run oc -n "$PD_NS_CCTV" delete taskruns --all --wait=false 2>&1 | tail -2

# ── Step 5: delete IS + Knative residue ───────────────────────────────────
banner "Step 5 · Delete InferenceService + Knative Service/Configuration/Revision"
run oc -n "$PD_NS_CCTV" delete inferenceservice --all --ignore-not-found --wait=false
run oc -n "$PD_NS_CCTV" delete ksvc --all --wait=false 2>&1 | tail -1
run oc -n "$PD_NS_CCTV" delete configurations.serving.knative.dev --all --wait=false 2>&1 | tail -1
run oc -n "$PD_NS_CCTV" delete revisions.serving.knative.dev --all --wait=false 2>&1 | tail -1

# ── Step 6: scale GPU to 0 ────────────────────────────────────────────────
# Note the `--replicas=0 --` ordering: even with a correctly-resolved prefix,
# defending against future flag-parsing oddness costs nothing.
banner "Step 6 · Scale GPU MachineSet 1 → 0"
run oc -n openshift-machine-api scale --replicas=0 -- machineset/"${PD_MACHINESET_PREFIX}-gpu-demo-us-east-1a"

# ── Step 7: scale workers back to baseline ────────────────────────────────
banner "Step 7 · Scale worker MachineSets 2 → 1 per AZ"
for az in 1a 1b 1c; do
  run oc -n openshift-machine-api scale --replicas=1 -- machineset/"${PD_MACHINESET_PREFIX}-worker-us-east-${az}"
done

# ── Step 8 + 9: HARD only — delete sensitive Secrets + IAM user ───────────
if "$HARD"; then
  banner "Step 8 (HARD) · Delete sensitive Secrets in pd-cctv + pd-personas"
  for ns in "$PD_NS_CCTV" "$PD_NS_PERSONAS"; do
    for s in pd-anthropic-key pd-aurora-credentials pd-portkey-key pd-s3-creds pd-kserve-s3-creds; do
      run oc -n "$ns" delete secret "$s" --ignore-not-found
    done
  done

  banner "Step 9 (HARD) · Delete IAM user pd-demo-s3-rw"
  if ! "$DRY_RUN"; then
    AWS_PROFILE="$PD_AWS_PROFILE"; export AWS_PROFILE
    if aws sts get-caller-identity >/dev/null 2>&1; then
      KEYS=$(aws iam list-access-keys --user-name pd-demo-s3-rw \
              --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null || echo "")
      for k in $KEYS; do aws iam delete-access-key --user-name pd-demo-s3-rw --access-key-id "$k"; done
      aws iam delete-user-policy --user-name pd-demo-s3-rw --policy-name pd-s3-rw 2>/dev/null || true
      aws iam delete-user --user-name pd-demo-s3-rw 2>/dev/null && ok "IAM user deleted" || warn "IAM user not deleted (may not exist or active session)"
    else
      warn "AWS SSO session expired; skipping IAM cleanup"
    fi
  fi

  banner "Step 10 (HARD) · Delete bootstrap ArgoCD app (cascades to children)"
  run oc -n openshift-gitops delete application.argoproj.io pd-bootstrap --ignore-not-found
  warn "next bring-up will need to re-apply the bootstrap (full ~15 min); use a soft teardown next time if iterating"
fi

banner "DONE"
cat <<EOF >&2

  Soft teardown leaves persona pod + ArgoCD apps in place so a re-bring-up
  is just: scale workers + GPU, drain, sweep webhooks, apply IS, wait predictor.
  Run ./provision_and_build_police_department_demo.sh to come back up.

  Hard teardown also removed: Anthropic Secret, Aurora Secret, S3 IAM user,
  ArgoCD bootstrap App. Next bring-up needs --rotate-keys (auto) and a full
  ArgoCD sync (~15 min added).

EOF
ok "teardown complete"
