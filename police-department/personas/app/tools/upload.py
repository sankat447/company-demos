"""Multipart mp4 upload → S3 → trigger Tekton EventListener immediately.

Avoids the 60s S3-watcher polling lag for UI uploads. The user drops a
file, the persona backend streams it to S3 and POSTs the trigger event
in one request, and the UI starts polling pipeline status immediately.

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

log = logging.getLogger(__name__)

_BUCKET = os.environ.get("PD_S3_BUCKET", "ai-demo-data-lake")
_PREFIX = os.environ.get("PD_S3_CLIP_PREFIX", "clips/police-department/")
_REGION = os.environ.get("AWS_REGION", "us-east-1")
_EL_URL = os.environ.get(
    "PD_EL_URL",
    "http://el-pd-perception.pd-cctv.svc.cluster.local:8080/",
)


def _s3():
    return boto3.client(
        "s3",
        region_name=_REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("AWS_SESSION_TOKEN") or None,
    )


def upload_clip(local_path: str | Path, *, uploaded_by: str = "ui") -> dict:
    """Upload a local mp4 to S3 and trigger the EventListener.

    Returns: {clip_id, s3_uri, key, event_id}.
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
    }
    headers = {"Content-Type": "application/json",
               "Ce-Type": "pd.s3.clip.uploaded.v1"}
    log.info("POST %s payload=%s", _EL_URL, payload)
    with httpx.Client(timeout=20) as cli:
        resp = cli.post(_EL_URL, json=payload, headers=headers)
        resp.raise_for_status()
        body = resp.json() if "json" in resp.headers.get("content-type", "") else {}
    return {
        "clip_id": clip_id,
        "s3_uri": s3_uri,
        "key": key,
        "event_id": body.get("eventID"),
    }
