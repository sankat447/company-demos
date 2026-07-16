#!/usr/bin/env bash
# =============================================================================
#  Amboy NPI-Safe demo — DEMO RESET (AWS; between demo run-throughs)
#
#  Same semantics as the baremetal demo-reset.sh, re-plumbed for the AWS stack:
#    - single ns `amboy`; S3 instead of MinIO (same boto3 code paths in-pod)
#    - Aurora instead of an in-cluster PG pod -> SQL runs via python/psycopg
#      INSIDE the deid-gateway pod (no psql pod exists on AWS)
#
#  Resets to a fresh start WITHOUT tearing anything down:
#    - PII model served as BASE only; ACCOUNT rules + run marker cleared
#    - uploaded artifacts + indexed comparisons purged (rows, chunks, S3 objects)
#    - all Data Science Pipeline RUNS deleted (pipeline/server/base model KEPT)
#
#  Run between demos:  ./demo-reset.sh        (or -y to skip the prompt)
# =============================================================================
set -uo pipefail
NS=amboy
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
[ -n "$DPOD" ] && [ -n "$APOD" ] || err "demo pods not found (is it deployed?)"

# 1) serve base only (reload unload + active marker + OpenShift AI display-name)
info "serving the base model (dropping any fine-tuned head)…"
oc -n "$NS" exec -i "$APOD" -- python -c "from app.compare_agent import training as T; T.switch('piiranha-base-v1')" >/dev/null 2>&1 || true

# 2) S3 sweep: head artifacts, ACCOUNT rules, run marker, question markers, uploads
info "clearing S3 (heads, rules, markers, uploaded artifacts)…"
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
print("s3 swept")
PY

# 3) Aurora sweep via psycopg in-pod (no psql pod on AWS)
info "clearing Aurora (versions, comparisons, uploaded chunks, artifacts)…"
oc -n "$NS" exec -i "$DPOD" -- python - <<'PY' || true
from app.common import db
with db.connect() as conn:
    cur = conn.cursor()
    cur.execute("DELETE FROM amboy.model_versions WHERE name='npi-tagger'")
    cur.execute("DELETE FROM amboy.comparison_metrics")
    cur.execute("DELETE FROM amboy.comparisons")
    cur.execute("DELETE FROM amboy.chunks WHERE report_id LIKE '%::%'")
    cur.execute("DELETE FROM amboy.artifacts")
print("aurora swept")
PY

# 4) delete all Data Science Pipeline runs (keep the pipeline + experiment)
info "deleting OpenShift AI pipeline runs…"
oc -n "$NS" exec -i "$APOD" -- python - <<'PY' || true
import os, httpx
tok = open("/var/run/secrets/kubernetes.io/serviceaccount/token").read().strip()
b = os.environ.get("DSP_HOST", "https://ds-pipeline-amboy-dsp.amboy.svc:8443") + "/apis/v2beta1"
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
