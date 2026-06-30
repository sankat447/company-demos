#!/usr/bin/env bash
# Single-image, multi-role entrypoint (amboy pattern). Role chosen by NYCHHC_ROLE.
#   backend   -> FastAPI copilot API (default)          :8000
#   predictor -> CPU sklearn KServe-v1 predictor        :8080
set -euo pipefail
ROLE="${NYCHHC_ROLE:-backend}"
case "$ROLE" in
  backend)
    exec uvicorn nychhc_copilot.main:app --host 0.0.0.0 --port "${PORT:-8000}" ;;
  predictor)
    exec uvicorn nychhc_copilot.serving.predictor:app --host 0.0.0.0 --port "${PORT:-8080}" ;;
  *)
    echo "unknown NYCHHC_ROLE=$ROLE (want: backend|predictor)" >&2; exit 1 ;;
esac
