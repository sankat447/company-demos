"""LLM mode resolution for the persona service.

Modes (read from the `pd-llm-mode` ConfigMap, mounted at /etc/pd-llm-mode/):
  - mock     : in-process canned responses, no network call. Default during
               UI development so we can dry-run UX without GPU billing.
  - local    : route through Portkey to the cluster-hosted llama-3-1-8b
               (or llama-3-1-70b once GPU is up).
  - claude   : route through Portkey to Anthropic Claude (the gateway has a
               configured virtual key; flip mode and the same /chat URL
               just hits a different backend).

The ConfigMap is the single switch for the entire app (vlm-caption Tekton
task reads it the same way). Hot-reloaded — every request re-reads the
file, so `oc patch configmap pd-llm-mode --type=merge -p '{"data":{"mode":"claude"}}'`
takes effect immediately, no rollout.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

_MODE_FILE = Path(os.environ.get("PD_LLM_MODE_FILE",
                                 "/etc/pd-llm-mode/mode"))
_DEFAULT = os.environ.get("PD_LLM_MODE_DEFAULT", "mock")

VALID_MODES = ("mock", "local", "claude")


def current() -> str:
    """Return the active mode. Falls back to the env default if the
    ConfigMap isn't mounted (e.g. during local dev)."""
    try:
        if _MODE_FILE.is_file():
            v = _MODE_FILE.read_text().strip()
            if v in VALID_MODES:
                return v
            log.warning("invalid mode %r in %s; falling back to default", v, _MODE_FILE)
    except Exception as e:
        log.warning("could not read %s: %s", _MODE_FILE, e)
    return _DEFAULT if _DEFAULT in VALID_MODES else "mock"


def set_mode(mode: str) -> str:
    """Patch the active mode. Writes to the file the ConfigMap mounts."""
    if mode not in VALID_MODES:
        raise ValueError(f"invalid mode {mode!r}; valid: {VALID_MODES}")
    # In-cluster: the file is read-only (mounted ConfigMap). The UI's mode
    # toggle goes through the K8s API (see web router) to patch the
    # ConfigMap, NOT this writer. This writer is only useful for local
    # dev where the path points at a writable location.
    try:
        _MODE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _MODE_FILE.write_text(mode)
    except OSError as e:
        log.warning("set_mode local-write failed (likely read-only mount): %s", e)
    return mode
