"""Runtime configuration.

All values have demo-safe defaults so the service boots in **echo mode** with no
cluster dependencies. Real service endpoints are populated from env / Vault / SSM
when those layers are wired (see ARCHITECTURE.md L5–L9).
"""

from __future__ import annotations

from enum import Enum

from pydantic_settings import BaseSettings, SettingsConfigDict


class Mode(str, Enum):
    """Backend operating mode.

    echo  — no external deps; the copilot echoes input. Used for scaffold tests.
    live  — real Portkey/agent/tools wiring (added in later steps).
    """

    echo = "echo"
    live = "live"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NYCHHC_", env_file=".env", extra="ignore")

    # --- core ---
    mode: Mode = Mode.echo
    app_name: str = "NYC H+H Workforce & Patient-Flow Copilot"
    # OTLP resource attribute service.name (Lesson L9)
    service_name: str = "nychhc-workforce-copilot"

    # --- LLM routing (Lesson L5: ALL calls via Portkey, never a direct model URL) ---
    # base_url accepts EITHER the cluster svc (mesh-internal) OR Portkey's Route
    # (HTTPS). Flipping this is how we sidestep the STRICT-mTLS-from-outside-mesh
    # trap (ARCHITECTURE.md D1) without a code change.
    portkey_base_url: str = "http://portkey.ai-demo.svc:8787"
    portkey_api_key: str = "dummy"   # gateway/admin key; from Vault in live (L6)
    portkey_virtual_key: str = ""    # provider virtual key; from Vault in live (L6)
    # The in-cluster Portkey Route uses the OpenShift default (self-signed) ingress
    # cert. Set false to skip TLS verification for that internal route (demo only;
    # prod would trust the ingress CA / use a real cert). See docs/COMPLIANCE.md.
    portkey_verify_ssl: bool = True
    primary_model: str = "llama-3-1-8b"  # vLLM on KServe
    fallback_model: str = "bedrock-claude-3-haiku"  # Bedrock via Portkey (IRSA)
    llm_temperature: float = 0.1
    llm_request_timeout_s: float = 60.0
    llm_max_tokens: int = 600   # cap so a small model can't ramble into a fake transcript

    # --- data plane (populated in the data-wiring step) ---
    aurora_dsn: str = ""        # from SSM /ai-demo/aurora/endpoint (L7)
    mongo_uri: str = ""         # audit log
    redis_url: str = ""         # session cache
    minio_endpoint_url: str = ""  # S3-compatible (L8)

    # --- predictive models (DR-06 / DR-08), fixed KServe endpoints ---
    noshow_model_url: str = ""
    forecast_model_url: str = ""
    # When True and an endpoint is unreachable, degrade to LLM+rules (confirmed design).
    models_fallback_enabled: bool = True

    # --- workflow (DR-05/07/09 human-in-the-loop + alerts) ---
    n8n_webhook_url: str = ""  # n8n webhook for schedule-change approval routing

    # --- telemetry (Lesson L9) ---
    otel_endpoint: str = "otel-collector.observability.svc:4317"
    otel_enabled: bool = False  # off in echo mode; on in live

    # --- CORS for the Streamlit/Open WebUI frontends ---
    cors_allow_origins: list[str] = ["*"]


_settings: Settings | None = None


def get_settings() -> Settings:
    """Cached settings accessor (FastAPI dependency-friendly)."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
