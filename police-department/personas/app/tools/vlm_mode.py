"""VLM mode resolution for the persona service UI.

The pipeline-side switch (parallel to mode.py for the chat-side LLM).
Reads the `pd-vlm-mode` ConfigMap (in pd-cctv ns) — but persona pod
runs in pd-personas, so we hit the K8s API rather than mounting a file.
The vlm-caption Tekton task DOES mount this CM at /etc/pd-vlm-mode/.

Only used by the UI to display the current value and let the operator
flip it via /api/vlm-mode. The actual mode-resolution is done by the
Tekton task at pipeline-time.

Modes:
  local              -> in-cluster Qwen-VL (no egress).
  claude-multimodal  -> Anthropic Claude with frame upload at ingest only.
"""
from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)

VALID_MODES = ("local", "claude-multimodal")
DEFAULT_MODE = "local"

_PIPELINE_NS = os.environ.get("PD_PIPELINE_NAMESPACE", "pd-cctv")
_VLM_MODE_CM = os.environ.get("PD_VLM_MODE_CM", "pd-vlm-mode")


def _k8s():
    """Lazy-import the kubernetes client so the persona pod doesn't crash
    if it's run outside the cluster (no in-cluster service account)."""
    from kubernetes import client, config
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CoreV1Api()


def current() -> dict[str, str]:
    """Return the full ConfigMap contents (mode + frames + resolution +
    jpeg_quality) so the UI can show all knobs at once."""
    try:
        cm = _k8s().read_namespaced_config_map(_VLM_MODE_CM, _PIPELINE_NS)
        data = cm.data or {}
    except Exception as e:
        log.warning("vlm_mode.current() read failed: %s — defaulting", e)
        data = {}
    mode = data.get("mode", DEFAULT_MODE)
    if mode not in VALID_MODES:
        mode = DEFAULT_MODE
    return {
        "mode": mode,
        "frames": data.get("frames", "16"),
        "resolution": data.get("resolution", "1280"),
        "jpeg_quality": data.get("jpeg_quality", "2"),
    }


def set_mode(mode: str, *, frames: str | None = None,
             resolution: str | None = None, jpeg_quality: str | None = None) -> dict[str, str]:
    """Patch the ConfigMap. mode is required; other knobs only if supplied."""
    if mode not in VALID_MODES:
        raise ValueError(f"invalid vlm-mode {mode!r}; valid: {VALID_MODES}")
    patch_data: dict[str, str] = {"mode": mode}
    if frames is not None:
        patch_data["frames"] = str(int(frames))   # validates int
    if resolution is not None:
        patch_data["resolution"] = str(int(resolution))
    if jpeg_quality is not None:
        patch_data["jpeg_quality"] = str(int(jpeg_quality))
    _k8s().patch_namespaced_config_map(
        name=_VLM_MODE_CM,
        namespace=_PIPELINE_NS,
        body={"data": patch_data},
    )
    log.info("vlm-mode patched: %s", patch_data)
    return current()
