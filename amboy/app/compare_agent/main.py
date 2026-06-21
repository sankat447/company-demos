"""Amboy compare-agent API. /analyze runs the narrate-only agent, grounds the
narrative against tool outputs, audits the LLM call (NPI-free), and logs an
MLflow eval run."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.common import config, db
from app.compare_agent import agent, chat

app = FastAPI(title="amboy-compare-agent")


class ChatReq(BaseModel):
    comparison_id: str = "AMB-2024-2025"
    year_a: int = 2024
    year_b: int = 2025
    message: str
    history: list[dict] = []


class AnalyzeRequest(BaseModel):
    report_id_a: str = "AMB-FY2024"
    report_id_b: str = "AMB-FY2025"
    year_a: int = 2024
    year_b: int = 2025
    question: str | None = None
    shock_bps: int = 200


def _mlflow_log(req: AnalyzeRequest, result: dict):
    try:
        import mlflow
        mlflow.set_tracking_uri(config.MLFLOW_URL)
        mlflow.set_experiment("amboy-npi-compare")
        with mlflow.start_run():
            mlflow.log_params({"report_a": req.report_id_a, "report_b": req.report_id_b,
                               "model": config.LLM_MODEL, "mode": result["mode"]})
            mlflow.log_metric("grounding_score", result["grounding"]["grounding_score"])
            mlflow.log_metric("ungrounded_figures", len(result["grounding"]["ungrounded"]))
    except Exception:
        pass  # MLflow is best-effort; never block the analysis


@app.get("/healthz")
def healthz():
    return {"ok": True, "role": "compare_agent"}


@app.get("/comparisons")
def comparisons():
    return chat.list_comparisons()


@app.get("/comparisons/{cid}/status")
def comparison_status(cid: str):
    return chat.comparison_status(cid)


@app.get("/audit")
def audit(limit: int = 100):
    return chat.list_audit(limit)


class CompareDocsReq(BaseModel):
    comparison_id: str


@app.post("/compare_docs")
def compare_docs(req: CompareDocsReq):
    return chat.compare_docs(req.comparison_id)


@app.post("/chat")
def chat_sse(req: ChatReq):
    return StreamingResponse(chat.stream(req), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    result = agent.run_agent(req.report_id_a, req.report_id_b, req.year_a, req.year_b,
                             req.question, req.shock_bps)
    _mlflow_log(req, result)
    try:
        with db.connect() as conn:
            # NPI-free audit: mode + grounding only, never the narrative text.
            db.audit(conn.cursor(), "compare-agent", "llm_call",
                     f"{req.report_id_a}->{req.report_id_b}",
                     {"mode": result["mode"],
                      "grounding_score": result["grounding"]["grounding_score"],
                      "ungrounded": len(result["grounding"]["ungrounded"])})
    except Exception:
        pass
    return result
