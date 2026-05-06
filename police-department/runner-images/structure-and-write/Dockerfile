# =============================================================================
#  pd-structure-runner — pre-baked dependencies for the structure-and-write
#  Tekton task. Saves ~2 min of `pip install` on every PipelineRun.
#
#  Single stage (UBI 9 Python 3.11 has the lib/lib64 symlink trap that
#  multi-stage builds tickle — see persona Dockerfile for the lesson).
# =============================================================================
FROM registry.access.redhat.com/ubi9/python-311:latest

USER 0
WORKDIR /opt/app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt ./
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

USER 1001
CMD ["python3"]
