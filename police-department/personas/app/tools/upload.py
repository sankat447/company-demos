"""Multipart mp4 upload → S3 → trigger Tekton EventListener immediately.

Avoids the 60s S3-watcher polling lag for UI uploads. The user drops a
file, the persona backend streams it to S3 and POSTs the trigger event
in one request, and the UI starts polling pipeline status immediately.

Dedupe: after firing the EventListener, this also patches the S3
watcher's cursor ConfigMap to add the just-uploaded key to seen_keys,
so the watcher's next minute tick won't fire a duplicate PipelineRun
for the same clip.

Credentials: reads from the `pd-s3-creds` Secret env vars (same Secret
the watcher CronJob and Tekton tasks use). For SSO/STS sessions, the
session_token is honoured. For long-lived IAM users, just access_key_id
+ secret_access_key.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import boto3
import httpx
from kubernetes import client as k8s_client
from kubernetes import config as k8s_config

log = logging.getLogger(__name__)

_BUCKET = os.environ.get("PD_S3_BUCKET", "ai-demo-data-lake")
_PREFIX = os.environ.get("PD_S3_CLIP_PREFIX", "clips/police-department/")
_REGION = os.environ.get("AWS_REGION", "us-east-1")
_EL_URL = os.environ.get(
    "PD_EL_URL",
    "http://el-pd-perception.pd-cctv.svc.cluster.local:8080/",
)
_WATCHER_NS = os.environ.get("PD_PIPELINE_NAMESPACE", "pd-cctv")
_WATCHER_CM = "pd-s3-watcher-cursor"


def _claim_key_in_watcher_cursor(key: str) -> None:
    """Best-effort: append `key` to the watcher's seen_keys so it skips on next tick.

    Read-modify-write race with the watcher itself is possible but the
    window is sub-second; worst case is one duplicate run, which is what
    we already get without this. Failures here MUST NOT fail the upload.
    """
    try:
        try:
            k8s_config.load_incluster_config()
        except k8s_config.ConfigException:
            k8s_config.load_kube_config()
        v1 = k8s_client.CoreV1Api()
        cm = v1.read_namespaced_config_map(_WATCHER_CM, _WATCHER_NS)
        existing = set(((cm.data or {}).get("seen_keys") or "").splitlines())
        if key in existing:
            return  # nothing to do
        existing.add(key)
        v1.patch_namespaced_config_map(
            name=_WATCHER_CM,
            namespace=_WATCHER_NS,
            body={"data": {"seen_keys": "\n".join(sorted(existing))}},
        )
        log.info("watcher cursor: added %s to seen_keys", key)
    except Exception as e:
        log.warning("watcher cursor patch failed (%s) — duplicate run possible "
                    "within 60s; harmless, ON CONFLICT (sha256) prevents data dupes", e)


def _s3():
    return boto3.client(
        "s3",
        region_name=_REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("AWS_SESSION_TOKEN") or None,
    )


def upload_clip(local_path: str | Path, *, uploaded_by: str = "ui",
                vlm_mode_override: str = "",
                vlm_frames: str = "") -> dict:
    """Upload a local mp4 to S3 and trigger the EventListener.

    vlm_mode_override / vlm_frames:
      Optional per-clip overrides for the pd-vlm-mode ConfigMap default,
      surfaced through the EventListener payload to the TriggerBinding to
      the Pipeline's vlm-mode-override / vlm-frames-override params, then
      to the vlm-caption Tekton task. Empty strings = inherit ConfigMap.

    Returns: {clip_id, s3_uri, key, event_id, vlm_mode_override}.
    """
    local_path = Path(local_path)
    if not local_path.is_file():
        raise FileNotFoundError(local_path)

    clip_id = str(uuid.uuid4())
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = f"{_PREFIX}ui-{ts}-{clip_id[:8]}.mp4"
    s3_uri = f"s3://{_BUCKET}/{key}"

    log.info("uploading %s -> %s", local_path, s3_uri)
    _s3().upload_file(str(local_path), _BUCKET, key,
                      ExtraArgs={"ContentType": "video/mp4"})

    payload = {
        "clip_s3_uri": s3_uri,
        "clip_id": clip_id,
        "uploaded_by": uploaded_by,
        # The TriggerBinding maps body.vlm_mode -> vlm-mode-override param;
        # the watcher CronJob path doesn't set these so they default to "".
        "vlm_mode": vlm_mode_override or "",
        "vlm_frames": vlm_frames or "",
    }
    headers = {"Content-Type": "application/json",
               "Ce-Type": "pd.s3.clip.uploaded.v1"}
    log.info("POST %s payload=%s", _EL_URL, payload)
    with httpx.Client(timeout=20) as cli:
        resp = cli.post(_EL_URL, json=payload, headers=headers)
        resp.raise_for_status()
        body = resp.json() if "json" in resp.headers.get("content-type", "") else {}

    # Dedup: claim the S3 key in the watcher's cursor so its next minute
    # tick doesn't fire a duplicate PipelineRun for the same clip.
    _claim_key_in_watcher_cursor(key)

    return {
        "clip_id": clip_id,
        "s3_uri": s3_uri,
        "key": key,
        "event_id": body.get("eventID"),
        "vlm_mode_override": vlm_mode_override or "",
    }
