# NYCHHC-BareMetal — single image, two roles (amboy pattern). Role = NYCHHC_ROLE.
#   backend   -> FastAPI copilot API (router + scheduling + tools)   :8000
#   predictor -> CPU sklearn KServe-v1 predictor (no-show + forecast) :8080
#
# SINGLE-STAGE on purpose: the UBI python multi-stage /opt/app-root/lib -> lib64
# symlink silently drops pip packages (lesson). Build context = NYCHHC-BareMetal/.
FROM registry.access.redhat.com/ubi9/python-311:latest

WORKDIR /opt/app-root/src

# Backend package + its agent/data extras (langchain, psycopg, boto3, ...).
COPY backend/pyproject.toml ./
COPY backend/src ./src
RUN pip install --no-cache-dir ".[agent,data]"

# Predictor stack — sklearn PINNED to the training version (joblib unpickle skew trap).
RUN pip install --no-cache-dir "scikit-learn==1.9.0" "joblib>=1.4" "numpy>=1.26"

# Bake the trained artifacts for the predictor role (MinIO-first, baked fallback).
COPY models/artifacts/noshow/model.joblib   /opt/app-root/models/noshow.joblib
COPY models/artifacts/forecast/model.joblib /opt/app-root/models/forecast.joblib

COPY build/entrypoint.sh /opt/app-root/entrypoint.sh
RUN chmod +x /opt/app-root/entrypoint.sh

EXPOSE 8000 8080
CMD ["/opt/app-root/entrypoint.sh"]
