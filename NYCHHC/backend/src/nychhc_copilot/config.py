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
    portkey_base_url: str = "http://portkey.ai-demo.svc:8787"
    portkey_virtual_key: str = ""  # sourced from Vault in live mode (L6)
    primary_model: str = "llama-3-1-8b"  # vLLM on KServe
    fallback_model: str = "bedrock-claude-3-haiku"  # Bedrock via Portkey (IRSA)

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
