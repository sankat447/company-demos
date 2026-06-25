"""Submit + track the NPI-tagger Data Science Pipeline via the OpenShift AI KFP v2
REST API. In-cluster the API is behind an oauth-proxy (8443); the agent SA token
passes it (route-get RBAC) and the service-CA validates TLS. Run state/tasks are
mapped to the console's stage-stepper shape so the UI shows the real pipeline DAG."""
import os

import httpx

HOST = os.environ.get("DSP_HOST", "https://ds-pipeline-amboy-dsp.iis-ai-ai.svc:8443")
API = HOST + "/apis/v2beta1"
CA = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
SVC_CA = "/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt"
TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
PIPELINE_NAME = "amboy-npi-tagger"
EXPERIMENT_NAME = "amboy-npi-tagger"
DASHBOARD = os.environ.get(
    "RHOAI_DASHBOARD", "https://rhods-dashboard-redhat-ods-applications.apps.ocp419.crucible.iisl.com")

# pipeline task display_name → console stage
PIPE_STAGES = [
    ("ingest-corpus", "Ingest NPI corpus", "Build the synthetic NPI corpus (incl. ACCOUNT)"),
    ("featurize",     "Featurize (MiniLM)", "Embed each token to 384-d features"),
    ("train-head",    "Train head",         "Fine-tune the NPI tagger head (CPU)"),
    ("evaluate",      "Evaluate",           "Held-out token accuracy (logged metric)"),
    ("register",      "Register version",   "Push head to MinIO + version registry"),
    ("deploy",        "Provision on OpenShift AI", "Scale KServe, load head, set display-name"),
    ("smoke",         "Online smoke test",  "Verify the served model answers /detect"),
]
_STATE_MAP = {
    "RUNTIME_STATE_UNSPECIFIED": "pending", "PENDING": "pending", "RUNNING": "running",
    "SUCCEEDED": "done", "SKIPPED": "pending", "FAILED": "failed", "CANCELING": "running",
    "CANCELED": "failed", "PAUSED": "pending",
}
_CURRENT = {"run_id": None, "experiment_id": None}


def _verify():
    return SVC_CA if os.path.exists(SVC_CA) else CA


def _headers():
    return {"Authorization": "Bearer " + open(TOKEN_PATH).read().strip()}


def _get(path, **params):
    r = httpx.get(API + path, headers=_headers(), params=params, verify=_verify(), timeout=20)
    r.raise_for_status()
    return r.json()


def _post(path, body):
    r = httpx.post(API + path, headers={**_headers(), "Content-Type": "application/json"},
                   json=body, verify=_verify(), timeout=30)
    r.raise_for_status()
    return r.json()


def _pipeline_id():
    for p in _get("/pipelines", page_size=100).get("pipelines", []):
        if p.get("display_name") == PIPELINE_NAME or p.get("name") == PIPELINE_NAME:
            return p["pipeline_id"]
    return None


def _latest_version(pid):
    vs = _get(f"/pipelines/{pid}/versions", sort_by="created_at desc",
              page_size=1).get("pipeline_versions", [])
    return vs[0]["pipeline_version_id"] if vs else None


def _experiment_id():
    for e in _get("/experiments", page_size=100).get("experiments", []):
        if e.get("display_name") == EXPERIMENT_NAME:
            return e["experiment_id"]
    try:
        return _post("/experiments", {"display_name": EXPERIMENT_NAME,
                                      "description": "Amboy NPI-tagger training runs"}).get("experiment_id")
    except Exception:
        return None


def _latest_run_id():
    """Most-recent run in our Experiment — robust to in-memory state loss
    (multiple uvicorn workers / pod restarts)."""
    try:
        eid = _experiment_id()
        params = {"page_size": 1, "sort_by": "created_at desc"}
        if eid:
            params["experiment_id"] = eid
        runs = _get("/runs", **params).get("runs", [])
        return runs[0]["run_id"] if runs else None
    except Exception:
        return None


def submit(epochs: int = 200, n_per_class: int = 120):
    try:
        pid = _pipeline_id()
        if not pid:
            return {"ok": False, "reason": "pipeline not uploaded yet — run the upload job"}
        vid = _latest_version(pid)
        eid = _experiment_id()
        body = {"display_name": "amboy-npi-tagger",
                "experiment_id": eid,
                "pipeline_version_reference": {"pipeline_id": pid, "pipeline_version_id": vid},
                "runtime_config": {"parameters": {"epochs": epochs, "n_per_class": n_per_class}}}
        r = _post("/runs", body)
        _CURRENT.update(run_id=r.get("run_id"), experiment_id=eid)
        return {"ok": True, "run_id": r.get("run_id"), "experiment_id": eid}
    except Exception as e:
        return {"ok": False, "reason": f"{type(e).__name__}: {str(e)[:120]}"}


def status(run_id: str | None = None):
    run_id = run_id or _CURRENT.get("run_id") or _latest_run_id()
    if not run_id:
        return {"ok": True, "status": "idle", "run_id": None,
                "stages": [{"key": k, "title": t, "desc": d, "status": "pending", "pct": 0}
                           for k, t, d in PIPE_STAGES]}
    try:
        r = _get(f"/runs/{run_id}")
    except Exception as e:
        return {"ok": False, "status": "error", "run_id": run_id, "reason": type(e).__name__,
                "stages": [{"key": k, "title": t, "desc": d, "status": "pending", "pct": 0}
                           for k, t, d in PIPE_STAGES]}
    state = r.get("state") or (r.get("run_details") or {}).get("state")
    tasks = {}
    for t in (r.get("run_details") or {}).get("task_details", []) or []:
        nm = (t.get("display_name") or "").replace("_", "-")
        if nm:
            tasks[nm] = t.get("state")
    stages = []
    for key, title, desc in PIPE_STAGES:
        st = _STATE_MAP.get(str(tasks.get(key)), "pending")
        stages.append({"key": key, "title": title, "desc": desc, "status": st,
                       "pct": 100 if st == "done" else (50 if st == "running" else 0)})
    overall = ("complete" if state == "SUCCEEDED"
               else "error" if state in ("FAILED", "CANCELED") else "running")
    return {"ok": True, "status": overall, "run_id": run_id, "run_state": state, "stages": stages}


def links():
    return {"experiments": f"{DASHBOARD}/experiments/iis-ai-ai",
            "pipelines": f"{DASHBOARD}/pipelines/iis-ai-ai",
            "run_id": _CURRENT.get("run_id")}
