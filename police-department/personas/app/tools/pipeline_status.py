"""Tekton PipelineRun + TaskRun status reader for the chat UI's progress panel.

The persona pod uses its in-cluster ServiceAccount token to talk to the
K8s API. The pd-personas SA needs RBAC to read pipelineruns/taskruns in
pd-cctv (added in manifests/personas/pd-persona-rbac.yaml).
"""
from __future__ import annotations

import logging
import os
from typing import Any

from kubernetes import client as k8s_client
from kubernetes import config as k8s_config

log = logging.getLogger(__name__)

_NS = os.environ.get("PD_PIPELINE_NAMESPACE", "pd-cctv")

_TASK_LABEL = "tekton.dev/pipelineTask"
_PR_LABEL = "tekton.dev/pipelineRun"

# Display order + labels shown in the UI
TASK_DISPLAY_ORDER = [
    ("pull-clip",            "Pulling clip"),
    ("vlm-caption",          "Captioning frames (VLM)"),
    ("whisper-asr",          "Transcribing audio (Whisper)"),
    ("yolo-detect",          "Detecting objects (YOLO)"),
    ("faces-and-plates",     "Faces & license plates"),
    ("structure-and-write",  "Indexing in Aurora"),
]


def _api() -> k8s_client.CustomObjectsApi:
    try:
        k8s_config.load_incluster_config()
    except k8s_config.ConfigException:
        k8s_config.load_kube_config()
    return k8s_client.CustomObjectsApi()


def _condition(obj: dict[str, Any], typ: str = "Succeeded") -> dict[str, Any]:
    for c in obj.get("status", {}).get("conditions", []) or []:
        if c.get("type") == typ:
            return c
    return {}


def _to_status(cond: dict[str, Any]) -> str:
    """Normalise Tekton condition into one of: pending, running, succeeded, failed."""
    if not cond:
        return "pending"
    s = cond.get("status", "")
    r = cond.get("reason", "")
    if s == "True":
        return "succeeded"
    if s == "False":
        return "failed"
    if r in ("Pending", "Started", "ResolvingTaskRef"):
        return "pending"
    return "running"


def find_run_for_clip(clip_id: str) -> str | None:
    """Locate the most recent PipelineRun for a given clip_id (matches param)."""
    api = _api()
    runs = api.list_namespaced_custom_object(
        group="tekton.dev", version="v1", namespace=_NS, plural="pipelineruns",
    )
    cands = []
    for pr in runs.get("items", []):
        params = {p["name"]: p.get("value") for p in pr.get("spec", {}).get("params", [])}
        if params.get("clip-id") == clip_id:
            cands.append(pr)
    if not cands:
        return None
    cands.sort(key=lambda x: x["metadata"]["creationTimestamp"], reverse=True)
    return cands[0]["metadata"]["name"]


def status_for_run(run_name: str) -> dict[str, Any]:
    """Return per-task status + overall status for a PipelineRun."""
    api = _api()
    try:
        pr = api.get_namespaced_custom_object(
            group="tekton.dev", version="v1", namespace=_NS,
            plural="pipelineruns", name=run_name,
        )
    except Exception as e:
        log.warning("pipelinerun %s not found: %s", run_name, e)
        return {"run": run_name, "overall": "missing", "tasks": []}

    overall = _to_status(_condition(pr))

    # Read TaskRuns owned by this PipelineRun
    trs = api.list_namespaced_custom_object(
        group="tekton.dev", version="v1", namespace=_NS, plural="taskruns",
        label_selector=f"{_PR_LABEL}={run_name}",
    )
    tr_by_task: dict[str, dict[str, Any]] = {}
    for tr in trs.get("items", []):
        task = tr.get("metadata", {}).get("labels", {}).get(_TASK_LABEL)
        if task:
            tr_by_task[task] = tr

    out_tasks = []
    for task_name, display in TASK_DISPLAY_ORDER:
        tr = tr_by_task.get(task_name)
        if tr is None:
            out_tasks.append({"name": task_name, "display": display,
                              "status": "pending", "duration_sec": None})
            continue
        cond = _condition(tr)
        status = _to_status(cond)
        start = tr.get("status", {}).get("startTime")
        end = tr.get("status", {}).get("completionTime")
        duration = None
        if start and end:
            from datetime import datetime as dt
            try:
                a = dt.fromisoformat(start.replace("Z", "+00:00"))
                b = dt.fromisoformat(end.replace("Z", "+00:00"))
                duration = (b - a).total_seconds()
            except Exception:
                duration = None
        out_tasks.append({
            "name": task_name,
            "display": display,
            "status": status,
            "duration_sec": duration,
            "reason": cond.get("reason"),
            "message": cond.get("message"),
        })

    return {"run": run_name, "overall": overall, "tasks": out_tasks}
