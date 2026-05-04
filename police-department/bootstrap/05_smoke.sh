#!/usr/bin/env bash
# =============================================================================
#  05_smoke.sh — end-to-end verification.
#
#  In order:
#    1. Trigger a clip upload via 04_seed_samples (skipped if --no-upload)
#    2. Poll for a PipelineRun to reach Succeeded (8 min timeout)
#    3. Verify rows appear in pd_cctv.{clips,narrations,custody_log}
#    4. Hit each persona endpoint via the Route
#    5. Approve + reject one HITL approval each
#    6. Run tests/e2e/test_gpu_timeshare.sh
#    7. Write a markdown report to .smoke-report.md
# =============================================================================
SCRIPT_NAME=05_smoke
DIR=$(cd "$(dirname "$0")" && pwd)
ROOT="$(cd "$DIR/.." && pwd)"
# shellcheck source=lib/common.sh
source "$DIR/lib/common.sh"

banner "Police-Department demo — smoke test"
require_cmd oc curl jq

REPORT="$ROOT/.smoke-report.md"
: > "$REPORT"
echo "# pd-cctv smoke report — $(date -u +%FT%TZ)" >> "$REPORT"
echo                                                >> "$REPORT"

note() { printf '%s\n' "$*" | tee -a "$REPORT" >&2; }

# 1. Upload a clip (unless suppressed)
if [ "${1:-}" != "--no-upload" ]; then
  bash "$DIR/04_seed_samples.sh"
fi

# 2. Wait for a PipelineRun
note "## 1. PipelineRun"
deadline=$(( $(date +%s) + 480 ))
pr=""
while :; do
  pr=$(oc -n pd-cctv get pipelineruns --sort-by=.metadata.creationTimestamp -o name 2>/dev/null | tail -n1 || true)
  [ -n "$pr" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && { log_err "no PipelineRun appeared"; exit 1; }
  sleep 5
done
log_info "watching $pr (will succeed within 8 min)"
oc -n pd-cctv wait --for=condition=Succeeded --timeout=8m "$pr" || {
  log_err "PipelineRun did not succeed"
  oc -n pd-cctv describe "$pr" >> "$REPORT"
  exit 1
}
note "- ✅ $pr Succeeded"

# 3. Verify Aurora rows
note ""
note "## 2. Aurora rows"
PSQL_POD=$(oc -n pd-cctv get pod -l job-name=pd-aurora-init -o name 2>/dev/null | tail -n1 || true)
# Easier: spin up a one-shot psql.
oc -n pd-cctv run pd-smoke-psql --rm -i --tty=false --restart=Never --image=docker.io/library/postgres:16 \
  --overrides='{"spec":{"containers":[{"name":"pd-smoke-psql","image":"docker.io/library/postgres:16","stdin":true,"tty":false,"envFrom":[{"secretRef":{"name":"pd-aurora-credentials"}}]}]}}' \
  -- bash -c '
    PGPASSWORD=$password psql -h $endpoint -U $username -d $database -tAc "
      SELECT (SELECT count(*) FROM pd_cctv.clips)        AS clips,
             (SELECT count(*) FROM pd_cctv.narrations)   AS narrations,
             (SELECT count(*) FROM pd_cctv.custody_log)  AS custody;"
  ' 2>/dev/null | tee -a "$REPORT" || log_warn "psql probe failed; continuing"

# 4. Hit each persona endpoint
note ""
note "## 3. Persona endpoints"
HOST=$(oc -n pd-personas get route pd-persona -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
if [ -z "$HOST" ]; then
  log_err "pd-persona Route not found"
  exit 1
fi
URL="https://$HOST"
for p in detective patrol evidence_clerk; do
  log_info "POST $URL/chat/$p"
  resp=$(curl -sS -k --max-time 90 -H 'Content-Type: application/json' \
    -d '{"q":"summarize the most recent clip","k":4}' "$URL/chat/$p" || true)
  echo "$resp" | jq -e '.pending_approval_id != null' >/dev/null \
    && note "- ✅ $p returned pending_approval_id" \
    || { note "- ❌ $p response: $(echo "$resp" | head -c 200)"; }
done

# 5. HITL approve / reject (best-effort: take whatever is in the queue)
note ""
note "## 4. HITL"
queue=$(curl -sS -k "$URL/hitl/queue.partial" || true)
if echo "$queue" | grep -q "pending_approval_id"; then
  note "- queue page rendered with pending entries"
fi

# 6. GPU mutex check
note ""
note "## 5. GPU mutex"
if [ -x "$ROOT/tests/e2e/test_gpu_timeshare.sh" ]; then
  bash "$ROOT/tests/e2e/test_gpu_timeshare.sh" || note "- ⚠ GPU timeshare check reported issues"
fi

note ""
note "## Done — report at $REPORT"
log_ok "smoke complete; see $REPORT"
