"""Amboy compare-agent (M2 stub — LangGraph narrate-only agent lands in M6)."""
from fastapi import FastAPI

app = FastAPI(title="amboy-compare-agent")


@app.get("/healthz")
def healthz():
    return {"ok": True, "role": "compare_agent"}
