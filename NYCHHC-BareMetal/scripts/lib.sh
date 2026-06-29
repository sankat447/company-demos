#!/usr/bin/env bash
# Shared helpers for deploy.sh / destroy.sh (NYCHHC-BareMetal).
# Sourced, not executed. Provides: logging, kubeconfig, in-cluster psql, MinIO,
# and Grafana dashboard provisioning against the in-stack baremetal platform.

# ── logging ──────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'
info(){ echo -e "  ${CYAN}➤${RESET} $*"; }
ok(){   echo -e "  ${GREEN}✔${RESET} $*"; }
warn(){ echo -e "  ${YELLOW}⚠${RESET} $*"; }
err(){  echo -e "  ${RED}✘${RESET} $*" >&2; exit 1; }

# ── fixed platform facts ─────────────────────────────────────────────────────
NS_AI=iis-ai-ai; NS_UI=iis-ai-ui; NS_DATA=iis-ai-data; NS_SYS=iis-ai-system
PG_HOST="iis-ai-postgres-primary.iis-ai-data.svc"
PG_DB="rhoai_demo"; PG_USER="rhoai_admin"
MINIO_ENDPOINT="http://minio.iis-ai-data.svc:9000"
GRAFANA_DS_UID="nychhc-postgres"
GRAFANA_DASH_UID="nychhc-workforce"

# ── kubeconfig ───────────────────────────────────────────────────────────────
# Default to the baremetal platform's admin kubeconfig (the default ~/.kube token
# is expired); override with KUBECONFIG in the environment.
nychhc_kubeconfig() {
  if [ -z "${KUBECONFIG:-}" ]; then
    local default="$HOME/GitHub/ai-demo-stack-baremetal/install/_artifacts/auth/kubeconfig"
    [ -f "$default" ] && export KUBECONFIG="$default"
  fi
}

require_cluster() {
  for t in oc kubectl python3; do command -v "$t" >/dev/null 2>&1 || err "missing tool: $t"; done
  oc whoami >/dev/null 2>&1 || err "not authenticated (set KUBECONFIG / oc login)"
  for ns in "$NS_AI" "$NS_UI" "$NS_DATA" "$NS_SYS"; do
    oc get ns "$ns" >/dev/null 2>&1 || err "namespace $ns missing — deploy the platform stack first"
  done
}

# ── in-cluster psql (throwaway pod; the platform PG has no external route) ────
# usage: psql_run "<SQL>"   — PG password taken from $PG_PASSWORD
psql_run() {
  local sql="$1" name="nychhc-psql-$$-$RANDOM"
  oc -n "$NS_DATA" run "$name" --rm -i --restart=Never --quiet \
    --image=docker.io/pgvector/pgvector:pg16 \
    --env=PGPASSWORD="${PG_PASSWORD:-Demo1234#}" -- \
    psql -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -c "$sql"
}

# ── Grafana (iis-ai-ui; admin/Demo1234#) ─────────────────────────────────────
grafana_base() {
  local host; host="$(oc -n "$NS_UI" get route grafana -o jsonpath='{.spec.host}' 2>/dev/null || true)"
  [ -n "$host" ] && echo "https://${host}"
}

# Provision a Postgres datasource + the NYCHHC dashboard. Best-effort (warns on fail).
grafana_provision() {
  local dash_file="$1" base; base="$(grafana_base)"
  [ -n "$base" ] || { warn "Grafana route not found in $NS_UI — skipping dashboard"; return 0; }
  local auth="admin:${GRAFANA_ADMIN_PASSWORD:-Demo1234#}"
  # 1) Postgres datasource (idempotent: delete by uid then create).
  curl -sk -u "$auth" -X DELETE "${base}/api/datasources/uid/${GRAFANA_DS_UID}" >/dev/null 2>&1 || true
  curl -sk -u "$auth" -X POST "${base}/api/datasources" -H 'Content-Type: application/json' -d "{
    \"uid\":\"${GRAFANA_DS_UID}\",\"name\":\"NYCHHC Postgres\",\"type\":\"postgres\",
    \"access\":\"proxy\",\"url\":\"${PG_HOST}:5432\",\"user\":\"${PG_USER}\",
    \"database\":\"${PG_DB}\",\"isDefault\":false,
    \"jsonData\":{\"sslmode\":\"disable\",\"postgresVersion\":1600,\"timescaledb\":false},
    \"secureJsonData\":{\"password\":\"${PG_PASSWORD:-Demo1234#}\"}}" >/dev/null 2>&1 \
    && ok "Grafana datasource 'NYCHHC Postgres' provisioned" \
    || warn "Grafana datasource provisioning failed (check $base)"
  # 2) Dashboard import (wrap the dashboard JSON in an import envelope).
  [ -f "$dash_file" ] || { warn "dashboard file $dash_file missing"; return 0; }
  python3 - "$dash_file" <<'PY' > /tmp/nychhc-dash-import.json
import json, sys
dash = json.load(open(sys.argv[1]))
dash["id"] = None
print(json.dumps({"dashboard": dash, "overwrite": True, "folderId": 0}))
PY
  curl -sk -u "$auth" -X POST "${base}/api/dashboards/db" -H 'Content-Type: application/json' \
    --data @/tmp/nychhc-dash-import.json >/dev/null 2>&1 \
    && ok "Grafana dashboard 'NYCHHC Workforce' imported" \
    || warn "Grafana dashboard import failed (check $base)"
}

grafana_remove() {
  local base; base="$(grafana_base)"
  [ -n "$base" ] || return 0
  local auth="admin:${GRAFANA_ADMIN_PASSWORD:-Demo1234#}"
  curl -sk -u "$auth" -X DELETE "${base}/api/dashboards/uid/${GRAFANA_DASH_UID}"  >/dev/null 2>&1 || true
  curl -sk -u "$auth" -X DELETE "${base}/api/datasources/uid/${GRAFANA_DS_UID}"   >/dev/null 2>&1 || true
  ok "Grafana dashboard + datasource removed"
}
