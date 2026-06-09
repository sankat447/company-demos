"""Tool providers (Aurora / models / workflow) + the factory that picks fake vs live."""

from __future__ import annotations

from dataclasses import dataclass

from ...config import Mode, Settings
from .base import (
    AuroraProvider,
    ChangeProposal,
    ForecastPoint,
    ModelProvider,
    QueryResult,
    ReadOnlySQLError,
    RiskScore,
    WorkflowProvider,
)
from .fake import FakeAurora, FakeModels, FakeWorkflow


@dataclass
class Providers:
    aurora: AuroraProvider
    models: ModelProvider
    workflow: WorkflowProvider
    using_fakes: bool


def build_providers(settings: Settings) -> Providers:
    """Live providers when config is present; otherwise deterministic fakes.

    In echo mode (or any time a DSN/URL is blank) we use fakes so the agent and
    tools run end-to-end with no cluster. When live model URLs ARE set, the live
    model provider still falls back to the fake on error (confirmed design D5).
    """
    use_live = settings.mode is Mode.live and bool(settings.aurora_dsn)
    if not use_live:
        fake_db = FakeAurora()
        return Providers(
            aurora=fake_db,
            models=FakeModels(fake_db),
            workflow=FakeWorkflow(),
            using_fakes=True,
        )

    from .live import LiveAurora, LiveModels, LiveWorkflow

    aurora = LiveAurora(settings.aurora_dsn)
    fallback_models = FakeModels(FakeAurora()) if settings.models_fallback_enabled else None
    models: ModelProvider
    if settings.noshow_model_url and settings.forecast_model_url:
        models = LiveModels(settings.noshow_model_url, settings.forecast_model_url, fallback=fallback_models)
    else:
        models = fallback_models or FakeModels(FakeAurora())
    workflow: WorkflowProvider = LiveWorkflow(settings.n8n_webhook_url) if settings.n8n_webhook_url else FakeWorkflow()
    return Providers(aurora=aurora, models=models, workflow=workflow, using_fakes=False)


__all__ = [
    "Providers", "build_providers",
    "AuroraProvider", "ModelProvider", "WorkflowProvider",
    "QueryResult", "RiskScore", "ForecastPoint", "ChangeProposal", "ReadOnlySQLError",
]
