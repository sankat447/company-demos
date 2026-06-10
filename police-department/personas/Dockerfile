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
    UVICORN_WORKERS=2 \
    PIP_NO_CACHE_DIR=1

# ── Layer cache strategy ──────────────────────────────────────────────────
# We split deps install from app code copy so that editing app/ doesn't
# re-pull torch/sentence-transformers/transformers (~1 GB, ~9 min) on every
# build. The deps layer reuses across builds whenever pyproject.toml's
# [project].dependencies hasn't changed.
#
#   Layer A: COPY pyproject.toml + extract deps + pip install <deps only>
#            -> reused unless pyproject changes
#   Layer B: COPY app + pip install --no-deps -e .
#            -> rebuilt on every code edit, takes ~5 s
#
# This makes a CSS or prompt edit rebuild in seconds instead of ~10 min.

# Layer A — deps. Heavy (~1 GB) but rarely changes.
COPY pyproject.toml ./
RUN pip install --upgrade pip && \
    python - <<'PY' > /tmp/requirements.txt
import tomllib
data = tomllib.loads(open("pyproject.toml", "rb").read().decode())
for d in data["project"]["dependencies"]:
    print(d)
PY
RUN pip install -r /tmp/requirements.txt

# Layer B — application code. Light, rebuilt per source change.
COPY app ./app
RUN pip install --no-deps -e .

# ffmpeg is needed by app/tools/thumbnail.py to extract a JPEG preview from
# uploaded clips. UBI 9 doesn't ship ffmpeg-free (Fedora-only). The
# imageio-ffmpeg pip wheel bundles a static binary; copy it into PATH so
# our `shutil.which("ffmpeg")` call finds it.
RUN python -c "import imageio_ffmpeg, shutil, os; \
    src=imageio_ffmpeg.get_ffmpeg_exe(); \
    os.makedirs('/usr/local/bin', exist_ok=True); \
    shutil.copy(src, '/usr/local/bin/ffmpeg'); \
    os.chmod('/usr/local/bin/ffmpeg', 0o755); \
    print('ffmpeg installed at:', shutil.which('ffmpeg'))"

EXPOSE 8000
USER 1001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
