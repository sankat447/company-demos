"""Amboy metrics-engine (M2 stub — /compare /scenario /flag_policy land in M5)."""
from fastapi import FastAPI

app = FastAPI(title="amboy-metrics-engine")


@app.get("/healthz")
def healthz():
    return {"ok": True, "role": "metrics_engine"}
