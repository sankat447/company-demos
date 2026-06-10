"""Tiny KServe-v1 sklearn predictor (version-matched to the trained joblibs).

Serves the no-show + coverage-forecast models baked into the image, so there's no
sklearn version-skew and no S3 dependency. Speaks the KServe v1 protocol the
backend's LiveModels client expects:
  POST /v1/models/{name}:predict  {"instances": [[...],...]} -> {"predictions": [...]}
FOR DEMONSTRATION ONLY — SYNTHETIC DATA.
"""

from __future__ import annotations

import os

import joblib
import numpy as np
from fastapi import FastAPI, Request

MODEL_DIR = os.environ.get("MODEL_DIR", "/opt/app-root/src/models")
app = FastAPI()
_cache: dict = {}


def _model(name: str):
    if name not in _cache:
        _cache[name] = joblib.load(f"{MODEL_DIR}/{name}.joblib")
    return _cache[name]


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/v1/models/{name}")
def status(name: str):
    try:
        _model(name)
        return {"name": name, "ready": True}
    except Exception as e:
        return {"name": name, "ready": False, "error": str(e)}


@app.post("/v1/models/{model_op}")
async def predict(model_op: str, req: Request):
    name = model_op.split(":")[0]  # strip ":predict"
    body = await req.json()
    X = np.array(body.get("instances", []), dtype=float)
    preds = _model(name).predict(X)
    return {"predictions": [float(p) for p in np.ravel(preds)]}
