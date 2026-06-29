"""Tiny KServe-v1 sklearn predictor — the `predictor` role of the single image.

Serves the no-show + coverage-forecast models on CPU. Speaks the KServe v1 protocol
the backend's LiveModels client expects:
  POST /v1/models/{name}:predict  {"instances": [[...],...]} -> {"predictions": [...]}

Model bytes are loaded **MinIO-first, baked-fallback** (the proven amboy pattern):
  1. If S3/MinIO is configured, pull s3://{bucket}/{name}/model.joblib from the
     in-stack MinIO (so the SERVED bytes are the artifact published to MinIO — the
     "model served from MinIO" story + RHOAI dashboard visibility).
  2. Otherwise (or on any S3 error) fall back to the joblib BAKED into the image at
     /opt/app-root/models/{name}.joblib — so the demo never hard-fails.

sklearn is pinned to the training version in the image to avoid joblib unpickle skew.
FOR DEMONSTRATION ONLY — SYNTHETIC DATA.
"""

from __future__ import annotations

import os

import joblib
import numpy as np
from fastapi import FastAPI, Request

# Baked-in artifacts (image build copies models/artifacts/{name}/model.joblib here).
BAKED_DIR = os.environ.get("NYCHHC_MODEL_DIR", "/opt/app-root/models")

# MinIO (S3-compatible) source for the published artifacts.
S3_ENDPOINT = os.environ.get("NYCHHC_MINIO_ENDPOINT_URL", "")
S3_BUCKET = os.environ.get("NYCHHC_S3_BUCKET", "nychhc-models")
S3_ACCESS_KEY = os.environ.get("NYCHHC_S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.environ.get("NYCHHC_S3_SECRET_KEY", "")

app = FastAPI()
_cache: dict = {}
_source: dict = {}


def _load_from_minio(name: str):
    """Return a loaded model from s3://{bucket}/{name}/model.joblib, or raise."""
    import io

    import boto3  # lazy

    s3 = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
    )
    buf = io.BytesIO()
    s3.download_fileobj(S3_BUCKET, f"{name}/model.joblib", buf)
    buf.seek(0)
    return joblib.load(buf)


def _model(name: str):
    if name not in _cache:
        # 1) MinIO-first (when configured)
        if S3_ENDPOINT and S3_SECRET_KEY:
            try:
                _cache[name] = _load_from_minio(name)
                _source[name] = f"minio:{S3_BUCKET}/{name}/model.joblib"
                return _cache[name]
            except Exception as e:  # pragma: no cover - network path
                print(f"[predictor] MinIO load failed for {name} ({e}); using baked artifact")
        # 2) Baked fallback
        _cache[name] = joblib.load(f"{BAKED_DIR}/{name}.joblib")
        _source[name] = f"baked:{BAKED_DIR}/{name}.joblib"
    return _cache[name]


@app.get("/")
def root():
    return {"status": "ok", "role": "predictor"}


@app.get("/v1/models/{name}")
def status(name: str):
    try:
        _model(name)
        return {"name": name, "ready": True, "source": _source.get(name)}
    except Exception as e:
        return {"name": name, "ready": False, "error": str(e)}


@app.post("/v1/models/{model_op}")
async def predict(model_op: str, req: Request):
    name = model_op.split(":")[0]  # strip ":predict"
    body = await req.json()
    X = np.array(body.get("instances", []), dtype=float)
    preds = _model(name).predict(X)
    return {"predictions": [float(p) for p in np.ravel(preds)]}
