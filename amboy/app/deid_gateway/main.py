"""Amboy deid-gateway (M2 stub — full /ingest + /detokenize land in M4)."""
from fastapi import FastAPI

app = FastAPI(title="amboy-deid-gateway")


@app.get("/healthz")
def healthz():
    return {"ok": True, "role": "deid_gateway"}
