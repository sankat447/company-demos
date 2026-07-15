#!/usr/bin/env bash
# =============================================================================
#  Amboy NPI-Safe demo — DEMO RESET (between demo run-throughs)
#
#  Returns the demo to a clean "fresh start" WITHOUT tearing anything down:
#    - PII model served as BASE only (no fine-tuned head); registry = base only
#    - ACCOUNT regex rules cleared; pipeline run marker cleared (console = idle)
#    - uploaded artifacts + indexed comparisons purged (rows, metrics, chunks,
#      MinIO objects, per-comparison question markers)
#    - all OpenShift AI Data Science Pipeline RUNS deleted (the pipeline itself,
#      the Pipeline Server, the seeded baseline, and the base model are KEPT)
#
#  Run between demos:  ./demo-reset.sh        (or -y to skip the prompt)
#  Needs: KUBECONFIG pointed at the cluster, demo already deployed.
# =============================================================================
set -uo pipefail
NS=iis-ai-ai
GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'
info(){ echo -e "  ${CYAN}-${RESET} $*"; }
ok(){   echo -e "  ${GREEN}OK${RESET} $*"; }
err(){  echo -e "  ${RED}x${RESET} $*" >&2; exit 1; }

command -v oc >/dev/null 2>&1 || err "oc not on PATH"
oc whoami >/dev/null 2>&1 || err "not authenticated (check KUBECONFIG)"

if [ "${1:-}" != "-y" ]; then
  echo -e "${BOLD}Reset the Amboy demo to a fresh start on $(oc whoami --show-server)?${RESET}"
  echo "  (clears trained heads, rules, uploads, comparisons + DSP runs; keeps base model,"
  echo "   the seeded baseline, the pipeline + Pipeline Server)"
  read -r -p "Type 'reset-amboy' to confirm: " c
  [ "$c" = "reset-amboy" ] || err "aborted"
fi

DPOD=$(oc -n "$NS" get pod -l app=amboy-deid-gateway --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}')
APOD=$(oc -n "$NS" get pod -l app=amboy-compare-agent --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}')
PGPOD=$(oc -n iis-ai-data get pod -l app=iis-ai-postgres -o jsonpath='{.items[0].metadata.name}')
[ -n "$DPOD" ] && [ -n "$APOD" ] && [ -n "$PGPOD" ] || err "demo pods not found (is it deployed?)"

# 1) serve base only (reload unload + active marker + OpenShift AI display-name)
info "serving the base model (dropping any fine-tuned head)…"
oc -n "$NS" exec -i "$APOD" -- python -c "from app.compare_agent import training as T; T.switch('piiranha-base-v1')" >/dev/null 2>&1 || true

# 2) MinIO sweep: head artifacts, ACCOUNT rules, run marker, question markers, uploads
info "clearing MinIO (heads, rules, markers, uploaded artifacts)…"
oc -n "$NS" exec -i "$DPOD" -- python - <<'PY' || true
import json
from app.common import config, objstore
c = objstore.client(); B = config.S3_BUCKET_DEID
def dels(prefix, pred):
    for o in c.list_objects_v2(Bucket=B, Prefix=prefix).get("Contents", []):
        if pred(o["Key"]):
            c.delete_object(Bucket=B, Key=o["Key"])
dels("models/", lambda k: k.endswith(".pt") and not k.startswith("models/base/"))
dels("models/", lambda k: k == "models/active_run.txt")
dels("comparisons/", lambda k: True)        # per-comparison LLM question markers
dels("artifacts/", lambda k: True)           # de-identified uploaded artifacts
c.put_object(Bucket=B, Key="models/account_patterns.json", Body=json.dumps([]).encode())
print("minio swept")
PY

# 3) Postgres sweep: trained versions, comparisons + metrics, uploaded chunks, artifacts
info "clearing Postgres (versions, comparisons, uploaded chunks, artifacts)…"
oc -n iis-ai-data exec "$PGPOD" -- psql -U rhoai_admin rhoai_demo -tAc \
  "DELETE FROM amboy.model_versions WHERE name='npi-tagger';
   DELETE FROM amboy.comparison_metrics;
   DELETE FROM amboy.comparisons;
   DELETE FROM amboy.chunks WHERE report_id LIKE '%::%';
   DELETE FROM amboy.artifacts;" >/dev/null 2>&1 || true

# 4) delete all Data Science Pipeline runs (keep the pipeline + experiment)
info "deleting OpenShift AI pipeline runs…"
oc -n "$NS" exec -i "$APOD" -- python - <<'PY' || true
import httpx
tok = open("/var/run/secrets/kubernetes.io/serviceaccount/token").read().strip()
b = "https://ds-pipeline-amboy-dsp.iis-ai-ai.svc:8443/apis/v2beta1"
ca = "/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt"
h = {"Authorization": "Bearer " + tok}
runs = httpx.get(b + "/runs", headers=h, params={"page_size": 200}, verify=ca, timeout=20).json().get("runs", [])
for r in runs:
    httpx.post(f"{b}/runs/{r['run_id']}:archive", headers=h, verify=ca, timeout=20)
    httpx.delete(f"{b}/runs/{r['run_id']}", headers=h, verify=ca, timeout=20)
print(f"deleted {len(runs)} run(s)")
PY

ok "Amboy demo reset — base model served, registry base-only, pipeline idle, no uploads/runs."
echo -e "  Demo flow: Intake -> Compare & Vectorize -> AI Insights -> Model Training (Run training pipeline)."
