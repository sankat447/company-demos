# Single-stage build. The earlier multi-stage version broke because the UBI
# Python image splits site-packages between /opt/app-root/lib and lib64
# (one is a symlink that Docker COPY follows but doesn't recreate); some
# wheels (python-multipart specifically) ended up in only one of them and
# the runtime stage missed them. Single stage avoids the symlink trap.
FROM image-registry.openshift-image-registry.svc:5000/openshift/python:3.11-ubi9

USER 0
WORKDIR /opt/app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UVICORN_WORKERS=2

# ffmpeg is needed by app/tools/thumbnail.py to extract a JPEG preview from
# the uploaded clip on demand. ffmpeg-free is in the UBI 9 AppStream repo.
RUN dnf install -y --setopt=tsflags=nodocs ffmpeg-free && dnf clean all

COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

EXPOSE 8000
USER 1001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
