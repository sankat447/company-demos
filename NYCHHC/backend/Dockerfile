# NYC H+H Workforce Copilot — backend
# Single-stage UBI Python build. (Lesson from platform repo: avoid multi-stage UBI
# Python copies — /opt/app-root/lib is a symlink to lib64 and pip packages get
# silently dropped. Single-stage sidesteps that entirely.)
FROM registry.access.redhat.com/ubi9/python-311:latest

# OpenShift runs containers with an arbitrary non-root UID (restricted-v2 SCC).
# The ubi python-311 image already supports this; we just keep group-writable perms.
WORKDIR /opt/app-root/src

COPY pyproject.toml ./
COPY src ./src

# Install the package + the layers the live image needs. (echo mode only needs core.)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir ".[agent,data,telemetry]"

ENV NYCHHC_MODE=echo \
    PYTHONUNBUFFERED=1

EXPOSE 8080

# Bind 8080 (OpenShift-friendly). Override NYCHHC_MODE=live once services are wired.
CMD ["uvicorn", "nychhc_copilot.main:app", "--host", "0.0.0.0", "--port", "8080"]
