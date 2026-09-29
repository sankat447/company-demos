# =============================================================================
#  pd-cv-runner — pre-baked torch + ultralytics + opencv for the CV steps
#  (object-detect, pose-estimate, weapon-detect, action-recognize).
#  Fixes lesson 17.58: fresh-cluster fresh-PVC pip install of these deps to
#  EFS blows past the 600 s step timeout, so tracking/pose/weapon/action get
#  silently skipped and the caption misses armed subjects.
#
#  Single stage — UBI 9 python-311 has the lib/lib64 symlink trap that
#  multi-stage builds tickle (see personas/Dockerfile / lesson 17.36).
# =============================================================================
FROM registry.access.redhat.com/ubi9/python-311:latest

USER 0
WORKDIR /opt/app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY requirements.txt ./
# Install ultralytics --no-deps then bring its deps in ourselves so we swap
# the transitive opencv-python for opencv-python-headless (avoids libGL, and
# every downstream cv2 import resolves to the headless build).
RUN pip install --upgrade pip && \
    pip install \
      torch torchvision \
      opencv-python-headless \
      numpy pillow pyyaml requests tqdm scipy \
      matplotlib pandas psutil py-cpuinfo seaborn && \
    pip install --no-deps ultralytics

USER 1001
CMD ["python3"]
