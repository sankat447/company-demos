#!/usr/bin/env bash
# Dispatch the single Amboy image to one of four roles via $AMBOY_ROLE.
# Default port 8080 for all FastAPI roles; Streamlit on 8501.
set -euo pipefail
ROLE="${AMBOY_ROLE:-metrics_engine}"
PORT="${PORT:-8080}"
echo "[amboy] starting role=${ROLE} port=${PORT}"

case "$ROLE" in
  deid_gateway)
    exec uvicorn app.deid_gateway.main:app --host 0.0.0.0 --port "${PORT}" ;;
  metrics_engine)
    exec uvicorn app.metrics_engine.main:app --host 0.0.0.0 --port "${PORT}" ;;
  compare_agent)
    exec uvicorn app.compare_agent.main:app --host 0.0.0.0 --port "${PORT}" ;;
  ui)
    exec streamlit run app/ui/app.py \
      --server.address=0.0.0.0 --server.port="${STREAMLIT_PORT:-8501}" \
      --server.headless=true --browser.gatherUsageStats=false ;;
  pii_model)
    exec uvicorn app.pii_model.main:app --host 0.0.0.0 --port "${PORT}" ;;
  seed)
    exec python -m app.seed ;;
  seed_base)
    exec python -m app.seed_base ;;
  *)
    echo "[amboy] unknown AMBOY_ROLE='${ROLE}' (deid_gateway|metrics_engine|compare_agent|ui)" >&2
    exit 64 ;;
esac
