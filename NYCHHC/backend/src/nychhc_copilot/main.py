"""FastAPI application entrypoint.

Boots in echo mode with no cluster dependencies. The copilot implementation is
selected by `NYCHHC_MODE`; routes depend only on the `Copilot` interface, so
wiring the real agent later won't touch the API layer.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .agent import EchoCopilot
from .config import Mode, get_settings
from .disclaimer import DISCLAIMER
from .api.routes import router


def _build_copilot(settings):
    if settings.mode is Mode.echo:
        return EchoCopilot(token_delay_s=0.02)  # small delay → visible streaming in the demo
    # Mode.live → real LangChain ReAct copilot (added in the agent-wiring step).
    raise RuntimeError("live mode not wired yet — run with NYCHHC_MODE=echo")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    app.state.copilot = _build_copilot(settings)
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
    return app


app = create_app()
