# Multi-stage build keeps the runtime image lean.
ARG PYTHON_VERSION=3.11
FROM registry.access.redhat.com/ubi9/python-${PYTHON_VERSION}:latest AS build

WORKDIR /opt/app
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

FROM registry.access.redhat.com/ubi9/python-${PYTHON_VERSION}:latest

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
