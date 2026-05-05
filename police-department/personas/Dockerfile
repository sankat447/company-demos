# Multi-stage build keeps the runtime image lean.
ARG PYTHON_VERSION=3.11
FROM image-registry.openshift-image-registry.svc:5000/openshift/python:3.11-ubi9 AS build

# UBI python image default user (1001) cannot write the egg-info directory
# created by `pip install .`. Switch to root for the build stage; the runtime
# stage stays at 1001.
USER 0
WORKDIR /opt/app
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

FROM image-registry.openshift-image-registry.svc:5000/openshift/python:3.11-ubi9

WORKDIR /opt/app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UVICORN_WORKERS=2

COPY --from=build /opt/app-root/lib/python3.11/site-packages /opt/app-root/lib/python3.11/site-packages
COPY --from=build /opt/app-root/bin /opt/app-root/bin
COPY app ./app

EXPOSE 8000
USER 1001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
