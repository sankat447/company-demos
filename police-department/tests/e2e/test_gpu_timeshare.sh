#!/usr/bin/env bash
# =============================================================================
#  test_gpu_timeshare.sh — verifies the Llama and Qwen-VL InferenceServices
#  never both report Ready: True at the same time.
#
#  Approach: poll their statuses every 5 s for a configurable duration
#  (default 90 s). If both are simultaneously Ready in any sample, the test
#  fails.
# =============================================================================
set -euo pipefail
DURATION_SEC="${1:-90}"
INTERVAL_SEC=5
end=$(( $(date +%s) + DURATION_SEC ))
violation_count=0

both_ready=$(mktemp)
trap 'rm -f "$both_ready"' EXIT

echo "[gpu-timeshare] sampling every ${INTERVAL_SEC}s for ${DURATION_SEC}s..."
while [ "$(date +%s)" -lt "$end" ]; do
  llama=$(oc -n ai-demo  get isvc llama-3-1-8b -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
  qwen=$(oc -n pd-cctv  get isvc pd-qwen25-vl-7b -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
  ts=$(date -u +%FT%TZ)
  echo "  $ts  llama=${llama:-?}  qwen=${qwen:-?}"
  if [ "$llama" = "True" ] && [ "$qwen" = "True" ]; then
    violation_count=$(( violation_count + 1 ))
    echo "    >>> VIOLATION: both Ready at $ts"
    echo "$ts" >> "$both_ready"
  fi
  sleep "$INTERVAL_SEC"
done

if [ "$violation_count" -gt 0 ]; then
  echo "[gpu-timeshare] FAILED: $violation_count samples had both Ready"
  exit 1
fi

echo "[gpu-timeshare] OK: no simultaneous-Ready samples observed."
