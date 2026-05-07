"""Single-page chat UI router.

Routes:
  GET  /              -- the SPA HTML
  GET  /static/...    -- mounted in main.py
  POST /api/upload    -- multipart mp4 upload, push to S3, fire EventListener
  GET  /api/clips     -- recent clips for the picker
  GET  /api/clip/{id} -- clip context (for chat panel)
  GET  /api/pipeline/{run}  -- one-shot status snapshot
  GET  /api/pipeline/by-clip/{clip_id} -- find run + status snapshot
  GET  /api/mode      -- current LLM mode
  POST /api/mode      -- switch LLM mode (ConfigMap patch via K8s API)
  GET  /api/chat/history/{clip_id} -- conversation log
"""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, Response
from kubernetes import client as k8s_client
from kubernetes import config as k8s_config

from app.tools import chat_history, clip_context, clip_url, mode, pipeline_status, thumbnail, upload as s3_upload, vlm_mode

log = logging.getLogger(__name__)
router = APIRouter()

_TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"
_INDEX_HTML = _TEMPLATE_DIR / "index.html"

_MAX_UPLOAD_MB = int(os.environ.get("PD_MAX_UPLOAD_MB", "300"))
_PD_LLM_MODE_CM = os.environ.get("PD_LLM_MODE_CM", "pd-llm-mode")
_PD_PERSONAS_NS = os.environ.get("PD_PERSONAS_NAMESPACE", "pd-personas")


@router.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse(_INDEX_HTML.read_text(encoding="utf-8"))


@router.get("/api/mode")
def get_mode() -> dict:
    return {"mode": mode.current(), "valid": list(mode.VALID_MODES)}


@router.get("/api/vlm-mode")
def get_vlm_mode() -> dict:
    cur = vlm_mode.current()
    return {**cur, "valid": list(vlm_mode.VALID_MODES)}


@router.post("/api/vlm-mode")
def set_vlm_mode(payload: dict) -> dict:
    new = (payload or {}).get("mode", "").strip()
    if new not in vlm_mode.VALID_MODES:
        raise HTTPException(400, f"invalid vlm-mode {new!r}; valid: {vlm_mode.VALID_MODES}")
    try:
        return vlm_mode.set_mode(
            new,
            frames=str(payload["frames"]) if payload.get("frames") is not None else None,
            resolution=str(payload["resolution"]) if payload.get("resolution") is not None else None,
            jpeg_quality=str(payload["jpeg_quality"]) if payload.get("jpeg_quality") is not None else None,
        )
    except Exception as e:
        log.warning("vlm-mode patch failed: %s", e)
        raise HTTPException(500, str(e))


@router.post("/api/mode")
def set_mode(payload: dict) -> dict:
    new = (payload or {}).get("mode", "").strip()
    if new not in mode.VALID_MODES:
        raise HTTPException(400, f"invalid mode {new!r}; valid: {mode.VALID_MODES}")
    # Patch the ConfigMap (which is mounted into this pod and into vlm-caption tasks).
    try:
        try:
            k8s_config.load_incluster_config()
        except k8s_config.ConfigException:
            k8s_config.load_kube_config()
        v1 = k8s_client.CoreV1Api()
        v1.patch_namespaced_config_map(
            name=_PD_LLM_MODE_CM,
            namespace=_PD_PERSONAS_NS,
            body={"data": {"mode": new}},
        )
        # Pod has the ConfigMap mounted; kubelet propagates updated keys
        # in ~60s. The mode.current() reader picks them up on next request.
        return {"mode": new, "note": "ConfigMap patched; kubelet sync in ~60s for vlm-caption tasks; persona reads on each request."}
    except Exception as e:
        log.warning("ConfigMap patch failed: %s — using local fallback", e)
        return {"mode": mode.set_mode(new), "note": "local-only fallback"}


@router.get("/api/clips")
def list_clips() -> dict:
    clips = clip_context.list_recent(limit=20)
    for c in clips:
        cid = c.get("clip_id")
        if cid:
            c["thumb_url"] = f"/api/thumb/{cid}"
    return {"clips": clips}


@router.get("/api/thumb/{clip_id}")
def thumb(clip_id: str) -> Response:
    data = thumbnail.get_jpeg(clip_id)
    if not data:
        raise HTTPException(404, f"no thumbnail available for clip {clip_id!r}")
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/api/clip/{clip_id}")
def get_clip(clip_id: str) -> dict:
    ctx = clip_context.load(clip_id)
    if not ctx:
        raise HTTPException(404, f"clip {clip_id!r} not found in Aurora")
    return ctx


@router.get("/api/clip/{clip_id}/video-url")
def get_clip_video_url(clip_id: str) -> dict:
    """Pre-signed S3 GET URL for the clip mp4. Browser plays it directly
    in a <video> element so the human reviewer can scrub to the
    timestamps the persona references."""
    out = clip_url.presign(clip_id)
    if not out:
        raise HTTPException(404, f"clip {clip_id!r} not found or has no S3 URI")
    return out


@router.post("/api/upload")
async def upload(file: UploadFile = File(...),
                 uploaded_by: str = Form("ui"),
                 vlm_mode_override: str = Form(""),
                 vlm_frames: str = Form("")) -> dict:
    # vlm_mode_override:
    #   ""                  -> let the Tekton task read pd-vlm-mode CM default.
    #   "local"             -> force in-cluster Qwen-VL for this clip.
    #   "claude-multimodal" -> force Anthropic Claude multimodal (sends the
    #                          frames once at ingest; chat is text-only).
    # The UI's "Deep analysis" checkbox sets this to "claude-multimodal".
    if vlm_mode_override and vlm_mode_override not in vlm_mode.VALID_MODES:
        raise HTTPException(400, f"invalid vlm_mode_override {vlm_mode_override!r}")
    # Stream to disk so we don't hold a 150 MB upload in RAM.
    suffix = Path(file.filename or "clip.mp4").suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        size = 0
        while chunk := await file.read(1024 * 1024):
            tmp.write(chunk)
            size += len(chunk)
            if size > _MAX_UPLOAD_MB * 1024 * 1024:
                tmp.close()
                Path(tmp.name).unlink(missing_ok=True)
                raise HTTPException(413, f"upload exceeds {_MAX_UPLOAD_MB} MB cap")
        tmp_path = tmp.name
    try:
        result = s3_upload.upload_clip(
            tmp_path,
            uploaded_by=uploaded_by,
            vlm_mode_override=vlm_mode_override,
            vlm_frames=vlm_frames,
        )
        result["size_bytes"] = size
        return result
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@router.get("/api/pipeline/by-clip/{clip_id}")
def pipeline_by_clip(clip_id: str) -> dict:
    run = pipeline_status.find_run_for_clip(clip_id)
    if not run:
        return {"run": None, "overall": "pending", "tasks": [
            {"name": t, "display": d, "status": "pending"}
            for (t, d) in pipeline_status.TASK_DISPLAY_ORDER
        ]}
    return pipeline_status.status_for_run(run)


@router.get("/api/pipeline/{run_name}")
def pipeline_one(run_name: str) -> dict:
    return pipeline_status.status_for_run(run_name)


@router.get("/api/chat/history/{clip_id}")
def chat_log(clip_id: str) -> dict:
    return {"clip_id": clip_id, "messages": chat_history.history(clip_id)}
