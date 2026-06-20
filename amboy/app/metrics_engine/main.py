"""Amboy metrics-engine — deterministic facts API the agent narrates from."""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.common import db
from app.metrics_engine import compute

app = FastAPI(title="amboy-metrics-engine")


def _facts(cur, report_id):
    facts = db.fetch_report_facts(cur, report_id)
    if not facts:
        raise HTTPException(404, f"no facts for report_id {report_id}")
    return facts


class CompareRequest(BaseModel):
    report_id_a: str
    report_id_b: str
    year_a: int
    year_b: int


class ScenarioRequest(BaseModel):
    report_id: str
    shock_bps: int = 200


class FlagRequest(BaseModel):
    report_id: str


@app.get("/healthz")
def healthz():
    return {"ok": True, "role": "metrics_engine"}


@app.post("/compare")
def compare(req: CompareRequest):
    with db.connect() as conn:
        cur = conn.cursor()
        result = compute.compare(_facts(cur, req.report_id_a), _facts(cur, req.report_id_b),
                                 req.year_a, req.year_b)
        db.audit(cur, "metrics-engine", "tool_call", "compare",
                 {"a": req.report_id_a, "b": req.report_id_b})
    return result


@app.post("/scenario")
def scenario(req: ScenarioRequest):
    with db.connect() as conn:
        cur = conn.cursor()
        result = compute.scenario(_facts(cur, req.report_id), req.shock_bps)
        db.audit(cur, "metrics-engine", "tool_call", "scenario",
                 {"report_id": req.report_id, "shock_bps": req.shock_bps})
    return result


@app.post("/flag_policy")
def flag_policy(req: FlagRequest):
    with db.connect() as conn:
        cur = conn.cursor()
        facts = _facts(cur, req.report_id)
        sectors = db.fetch_sector_facts(cur, req.report_id)
        result = compute.flag_policy(facts, sectors)
        db.audit(cur, "metrics-engine", "tool_call", "flag_policy",
                 {"report_id": req.report_id, "flags": result["flag_count"]})
    return result
