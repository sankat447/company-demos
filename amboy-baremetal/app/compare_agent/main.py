"""Amboy compare-agent API. /analyze runs the narrate-only agent, grounds the
narrative against tool outputs, audits the LLM call (NPI-free), and logs an
MLflow eval run."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app.common import config, db
from app.compare_agent import agent, chat, pipeline_client, training

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


@app.post("/training/start")
def training_start():
    return training.start()


@app.get("/training/status")
def training_status():
    return training.status()


class TrainCmdReq(BaseModel):
    command: str


@app.post("/training/cmd")
def training_cmd(req: TrainCmdReq):
    return training.cmd(req.command)


class SwitchReq(BaseModel):
    version: str


@app.post("/training/switch")
def training_switch(req: SwitchReq):
    return training.switch(req.version)


# ── OpenShift AI Data Science Pipeline (training runs under Experiments and runs) ──
class PipelineRunReq(BaseModel):
    epochs: int = 200
    n_per_class: int = 120


@app.post("/training/pipeline/run")
def training_pipeline_run(req: PipelineRunReq):
    return pipeline_client.submit(req.epochs, req.n_per_class)


@app.get("/training/pipeline/status")
def training_pipeline_status():
    return pipeline_client.status()


@app.get("/training/pipeline/links")
def training_pipeline_links():
    return pipeline_client.links()


@app.get("/training/versions")
def training_versions():
    with db.connect() as conn:
        return {"versions": db.list_model_versions(conn.cursor())}


@app.get("/training/served")
def training_served():
    """What the live KServe model is actually serving (base + fine-tuned head)."""
    import httpx
    try:
        h = httpx.get(f"{config.PII_MODEL_URL}/healthz", timeout=8).json()
        return {"ok": True, "base_version": h.get("base_version"),
                "head_version": h.get("head_version")}
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}


@app.get("/comparisons")
def comparisons():
    return chat.list_comparisons()


@app.get("/comparisons/{cid}/status")
def comparison_status(cid: str):
    return chat.comparison_status(cid)


@app.get("/comparisons/{cid}/suggested_questions")
def comparison_suggested_questions(cid: str):
    return chat.suggested_questions(cid)


@app.get("/audit")
def audit(limit: int = 100):
    return chat.list_audit(limit)


class CompareDocsReq(BaseModel):
    comparison_id: str


@app.post("/compare_docs")
def compare_docs(req: CompareDocsReq):
    return chat.compare_docs(req.comparison_id)


class ComparabilityReq(BaseModel):
    artifact_a: str
    artifact_b: str


@app.post("/comparability")
def comparability(req: ComparabilityReq):
    return chat.comparability(req.artifact_a, req.artifact_b)


class IndexComparisonReq(BaseModel):
    comparison_id: str
    label: str = ""
    artifact_a: str
    artifact_b: str
    accepted_fields: list[dict] = []
    year_a: int = 0
    year_b: int = 0
    suggested_questions: list[str] = []


@app.post("/index_comparison")
def index_comparison(req: IndexComparisonReq):
    return chat.index_comparison(req.comparison_id, req.label, req.artifact_a, req.artifact_b,
                                 req.accepted_fields, req.year_a, req.year_b,
                                 req.suggested_questions)


class ChatPdfReq(BaseModel):
    title: str = "Amboy comparison"
    generated_at: str | None = None
    messages: list[dict] = []


@app.post("/chat_pdf")
def chat_pdf(req: ChatPdfReq):
    pdf = chat.build_chat_pdf(req.title, req.messages, req.generated_at)
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="amboy-chat.pdf"'})


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
