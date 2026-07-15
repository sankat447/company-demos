# Amboy NPI-Safe demo — SINGLE image, 4 entrypoints (deid_gateway, metrics_engine,
# compare_agent, ui) dispatched by $AMBOY_ROLE. CPU-only; MiniLM baked for offline,
# in-cluster embeddings.
#
# SINGLE-STAGE on purpose: UBI python's /opt/app-root/lib is a symlink to lib64, and
# a multi-stage `COPY --from` of site-packages silently drops packages installed
# under the symlinked path. One stage = pip target and runtime are the same tree.
FROM registry.access.redhat.com/ubi9/python-311:latest

USER 0
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app \
    HF_HOME=/app/.hf \
    SENTENCE_TRANSFORMERS_HOME=/app/.hf \
    AMBOY_EMBED_MODEL=sentence-transformers/all-MiniLM-L6-v2

# CPU-only torch FIRST (separate index) so sentence-transformers doesn't drag in CUDA.
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.3.1

COPY build/requirements.txt /app/build/requirements.txt
RUN pip install --no-cache-dir -r /app/build/requirements.txt

# Application code (one tree, role chosen at runtime) + the seed generator.
COPY app/ /app/app/
COPY data/ /app/data/
COPY build/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Bake the MiniLM weights into the image so NO text (even de-identified) is ever
# sent out for vectorization, and pods start with no network model pull.
RUN python -c "from sentence_transformers import SentenceTransformer; \
import os; SentenceTransformer(os.environ['AMBOY_EMBED_MODEL'])"

# Bake the Piiranha PII/NPI detection model (CPU token-classification) so the
# pii-model role starts offline with no model pull at runtime.
ENV AMBOY_PII_MODEL=iiiorg/piiranha-v1-detect-personal-information
RUN python -c "import os; from transformers import AutoTokenizer, AutoModelForTokenClassification; \
m=os.environ['AMBOY_PII_MODEL']; AutoTokenizer.from_pretrained(m); AutoModelForTokenClassification.from_pretrained(m)"

# OpenShift runs containers with an arbitrary non-root UID in the root group.
RUN chgrp -R 0 /app && chmod -R g=u /app
USER 1001

ENV AMBOY_ROLE=metrics_engine
ENTRYPOINT ["/app/entrypoint.sh"]
