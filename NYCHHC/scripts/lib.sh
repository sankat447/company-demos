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
