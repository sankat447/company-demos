"""Runtime configuration (BAREMETAL edition).

All values have demo-safe defaults so the service boots in **echo mode** with no
cluster dependencies. Real service endpoints default to the in-stack baremetal
platform services (Postgres / MinIO / Portkey) and are overridden from env via the
gitops ConfigMap + the out-of-band ``nychhc-creds`` Secret on the cluster.

Cloud→baremetal mapping (see ARCHITECTURE.md):
  Aurora (SSM creds)            -> iis-ai-postgres-primary.iis-ai-data.svc:5432
  S3 data-lake + IAM            -> MinIO minio.iis-ai-data.svc:9000 (bucket nychhc-models)
  GPU granite vLLM via Portkey  -> Portkey http://portkey.iis-ai-ai.svc:8787 -> Claude
"""

from __future__ import annotations

from enum import Enum

from pydantic_settings import BaseSettings, SettingsConfigDict


class Mode(str, Enum):
    """Backend operating mode.

    echo  — no external deps; the copilot echoes input. Used for scaffold tests.
    live  — real Portkey/agent/tools wiring against the in-stack platform.
    """

    echo = "echo"
    live = "live"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NYCHHC_", env_file=".env", extra="ignore")

    # --- core ---
    mode: Mode = Mode.echo
    app_name: str = "NYC H+H Workforce & Patient-Flow Copilot"
    service_name: str = "nychhc-workforce-copilot"

    # --- LLM routing (ALL calls via Portkey; deterministic router stays primary) ---
    # base_url is the in-cluster Portkey service (OpenAI-compatible). The /v1 suffix
    # is appended by llm/portkey.py.
    portkey_base_url: str = "http://portkey.iis-ai-ai.svc:8787"
    portkey_api_key: str = ""        # Portkey/Anthropic key; from nychhc-creds Secret (live)
    portkey_virtual_key: str = ""    # Portkey provider virtual key (optional)
    portkey_provider: str = "anthropic"  # x-portkey-provider header (Claude via Portkey)
    portkey_verify_ssl: bool = True  # in-cluster svc is http; irrelevant unless a Route is used
    # No GPU on baremetal -> the open-ended fallback is Claude via Portkey. The
    # deterministic router answers the headline asks with NO LLM, so the demo works
    # even when portkey_api_key is blank (LLM path degrades gracefully).
    primary_model: str = "claude-sonnet-4-6"
    fallback_model: str = ""         # single provider on baremetal; no client-side 2nd alias
    llm_temperature: float = 0.1
    llm_request_timeout_s: float = 60.0
    # Anthropic via Portkey REQUIRES max_tokens on every request or the gateway 400s.
    llm_max_tokens: int = 600

    # --- data plane (in-stack platform services) ---
    # Postgres+pgvector replaces Aurora. DSN injected via the ConfigMap from the
    # nychhc-creds Secret. %23 == '#' (url-escaped, the password is Demo1234#).
    aurora_dsn: str = ""             # e.g. postgresql://rhoai_admin:Demo1234%23@iis-ai-postgres-primary.iis-ai-data.svc:5432/rhoai_demo
    minio_endpoint_url: str = "http://minio.iis-ai-data.svc:9000"  # S3-compatible (model artifacts)

    # --- predictive models (DR-06 / DR-08), fixed CPU KServe endpoints ---
    # Stable in-cluster ClusterIP Services in front of the KServe predictors.
    noshow_model_url: str = ""       # e.g. http://nychhc-noshow.iis-ai-ai.svc:8080/v1/models/noshow:predict
    forecast_model_url: str = ""     # e.g. http://nychhc-forecast.iis-ai-ai.svc:8080/v1/models/forecast:predict
    # When True and an endpoint is unreachable, degrade to rules (confirmed design D4).
    models_fallback_enabled: bool = True

    # --- workflow (DR-05/07/09): in-app impact engine only on baremetal; no n8n ---
    n8n_webhook_url: str = ""        # left blank -> FakeWorkflow; engine runs in-process

    # --- telemetry ---
    otel_endpoint: str = ""
    otel_enabled: bool = False

    # --- CORS for the static SPA frontend ---
    cors_allow_origins: list[str] = ["*"]


_settings: Settings | None = None


def get_settings() -> Settings:
    """Cached settings accessor (FastAPI dependency-friendly)."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
