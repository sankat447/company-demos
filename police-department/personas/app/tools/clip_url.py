"""Pre-signed S3 GET URL for the original clip mp4.

Returned to the UI so the browser's <video> element can fetch the bytes
directly from S3 — no proxying through this pod, no /v1/proxy egress
budget. Honours the same `pd-s3-creds` env vars as upload.py.

The persona pod has bucket-scoped read; the presigned URL expires in 300s
by default (long enough to start the stream) and is regenerated each
time the user picks a clip.
"""
from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import urlparse

import boto3
from botocore.config import Config

from app.tools import clip_context

log = logging.getLogger(__name__)

_REGION = os.environ.get("AWS_REGION", "us-east-1")
_DEFAULT_TTL = int(os.environ.get("PD_VIDEO_URL_TTL", "300"))


def _s3():
    # SigV4 is required for presigned URLs on regions enforcing it; the
    # default is "s3" which can produce SigV2 URLs that AWS rejects.
    return boto3.client(
        "s3",
        region_name=_REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("AWS_SESSION_TOKEN") or None,
        config=Config(signature_version="s3v4"),
    )


def _split_s3_uri(uri: str) -> tuple[str, str] | None:
    p = urlparse(uri)
    if p.scheme != "s3" or not p.netloc:
        return None
    return p.netloc, p.path.lstrip("/")


def presign(clip_id: str, ttl: int | None = None) -> dict[str, Any] | None:
    ctx = clip_context.load(clip_id)
    if not ctx:
        return None
    s3_uri = ctx.get("s3_uri") or ""
    parts = _split_s3_uri(s3_uri)
    if not parts:
        log.warning("clip %s has no resolvable s3_uri (%r)", clip_id, s3_uri)
        return None
    bucket, key = parts
    expires = int(ttl or _DEFAULT_TTL)
    url = _s3().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key, "ResponseContentType": "video/mp4"},
        ExpiresIn=expires,
    )
    return {"url": url, "expires_in": expires, "s3_uri": s3_uri}
