"""On-demand thumbnail generator for the chat UI's Recent Clips strip.

Given a clip_id, look up its S3 URI from the Aurora clips table, stream the
first ~2 MB of the mp4 from S3, ffmpeg-extract a single JPEG frame at
~1 second in (skips fade-in/black title cards), cache to /tmp, and return
the bytes. Pod restart drops the cache; that is fine for a demo.

ffmpeg is installed in the persona image (see Dockerfile). We shell out
rather than depending on PyAV/opencv to keep the persona image small.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.tools import clip_context

log = logging.getLogger(__name__)

_CACHE_DIR = Path(os.environ.get("PD_THUMB_CACHE_DIR", "/tmp/pd-thumbs"))
_CACHE_DIR.mkdir(parents=True, exist_ok=True)
_S3_BUCKET = os.environ.get("PD_S3_BUCKET", "ai-demo-data-lake")
_AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
_FFMPEG = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
# Seek offset in seconds. 1.0s is past most fade-ins / black title cards
# yet well within any clip we ingest.
_FRAME_AT = float(os.environ.get("PD_THUMB_AT_SEC", "1.0"))
# JPEG width in pixels. The UI tile is 64×36; 256 wide gives a sharp 4×
# retina image while staying under ~30 KB per JPEG.
_THUMB_W = int(os.environ.get("PD_THUMB_WIDTH", "256"))


def _cache_path(clip_id: str) -> Path:
    return _CACHE_DIR / f"{clip_id}.jpg"


def _s3_key_from_uri(s3_uri: str) -> Optional[str]:
    if not s3_uri or not s3_uri.startswith("s3://"):
        return None
    rest = s3_uri[len("s3://"):]
    parts = rest.split("/", 1)
    if len(parts) != 2:
        return None
    return parts[1]


def get_jpeg(clip_id: str) -> Optional[bytes]:
    """Return the JPEG thumbnail for `clip_id`, generating + caching if needed."""
    cached = _cache_path(clip_id)
    if cached.is_file() and cached.stat().st_size > 0:
        return cached.read_bytes()

    ctx = clip_context.load(clip_id)
    if not ctx:
        return None
    s3_uri = ctx.get("s3_uri") or ""
    key = _s3_key_from_uri(s3_uri)
    if not key:
        log.warning("thumbnail: clip %s has no usable s3_uri (%r)", clip_id, s3_uri)
        return None

    # Stream the clip to a temp file. We pull the whole object (small clips,
    # demo scale); ffmpeg can also read from a pipe but seeking past 1s on
    # an mp4 needs a moov-atom-near-front file, which we can't guarantee.
    s3 = boto3.client("s3", region_name=_AWS_REGION)
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        try:
            s3.download_file(_S3_BUCKET, key, tmp_path)
        except (BotoCoreError, ClientError) as e:
            log.warning("thumbnail: S3 download failed for %s: %s", key, e)
            return None

        # ffmpeg: seek to _FRAME_AT, take 1 frame, scale to _THUMB_W with
        # auto-height (preserve aspect), write JPEG.
        cmd = [
            _FFMPEG, "-y", "-loglevel", "error",
            "-ss", f"{_FRAME_AT:.2f}",
            "-i", tmp_path,
            "-frames:v", "1",
            "-vf", f"scale={_THUMB_W}:-2",
            "-q:v", "5",
            str(cached),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=20)
        except subprocess.CalledProcessError as e:
            # Some clips are shorter than _FRAME_AT or have no decodable frame
            # there; retry from the very start.
            log.info("thumbnail: ffmpeg seek failed (%s), retrying from start",
                     e.stderr.decode("utf-8", "replace")[:200])
            cmd_retry = [
                _FFMPEG, "-y", "-loglevel", "error",
                "-i", tmp_path,
                "-frames:v", "1",
                "-vf", f"scale={_THUMB_W}:-2",
                "-q:v", "5",
                str(cached),
            ]
            try:
                subprocess.run(cmd_retry, check=True, capture_output=True, timeout=20)
            except subprocess.CalledProcessError as e2:
                log.warning("thumbnail: ffmpeg retry failed: %s",
                            e2.stderr.decode("utf-8", "replace")[:200])
                return None
        except subprocess.TimeoutExpired:
            log.warning("thumbnail: ffmpeg timed out for clip %s", clip_id)
            return None
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    if not cached.is_file() or cached.stat().st_size == 0:
        return None
    return cached.read_bytes()
