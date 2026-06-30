"""FastAPI application entrypoint.

Boots in echo mode with no cluster dependencies. The copilot implementation is
selected by `NYCHHC_MODE`; routes depend only on the `Copilot` interface, so
wiring the real agent later won't touch the API layer.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .agent import EchoCopilot, SessionMemory, build_react_copilot
from .config import Mode, get_settings
from .disclaimer import DISCLAIMER
from .api.routes import router
from .api.data_routes import router as data_router
from .api.sched_routes import router as sched_router
from .api.mcp_routes import router as mcp_router
from .api.actions_routes import router as actions_router
from .scheduling import augment_seed, ensure_seeded
from .tools.providers import build_providers


def _build_copilot(settings, memory, providers):
    if settings.mode is Mode.echo:
        return EchoCopilot(token_delay_s=0.02)  # small delay → visible streaming in the demo
    # Mode.live → real LangChain ReAct copilot (Portkey → Claude, workforce tools),
    # sharing the app's provider bundle + per-session memory.
    return build_react_copilot(settings, memory=memory, providers=providers)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    app.state.providers = build_providers(settings)  # backs the data API (dashboard)
    app.state.memory = SessionMemory()               # per-session chat context
    try:
        ensure_seeded(app.state.providers.aurora)  # create + seed sched_* (idempotent)
        augment_seed(app.state.providers.aurora)    # additive enrichment (idempotent top-up)
    except Exception as e:  # don't block startup if seeding hiccups
        print(f"[scheduling] seed skipped: {e}")
    app.state.copilot = _build_copilot(settings, app.state.memory, app.state.providers)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description=f"{DISCLAIMER}",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(data_router)
    app.include_router(sched_router)
    app.include_router(mcp_router)      # UC8 — Epic/MCP FHIR tool surface
    app.include_router(actions_router)  # UC6 — HITL approval gate + audit
    return app


app = create_app()
