# Backend — Workforce & Patient-Flow Copilot

FastAPI + (soon) LangChain ReAct agent. Boots in **echo mode** with zero cluster
dependencies so the streaming path can be verified before services are wired.

> ⚠️ FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA.

## Run locally (echo mode)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q                         # echo-mode end-to-end tests
uvicorn nychhc_copilot.main:app --reload --port 8080
```

Then:

```bash
curl localhost:8080/health
curl localhost:8080/api/capabilities
curl -N -X POST localhost:8080/api/chat \
  -H 'content-type: application/json' \
  -d '{"message":"why is Tuesday understaffed?","role":"Scheduler"}'
```

## Layout

```
src/nychhc_copilot/
├── config.py        # settings; echo defaults, live endpoints (Portkey/Aurora/...)
├── disclaimer.py    # L10 — single source of the mandatory banner + envelope()
├── main.py          # FastAPI app; selects copilot by NYCHHC_MODE
├── agent/           # Copilot interface + EchoCopilot (real ReAct agent lands here)
└── api/             # routes (/health, /api/capabilities, /api/chat SSE) + schemas
```

## Modes

- `NYCHHC_MODE=echo` (default) — EchoCopilot, no external deps.
- `NYCHHC_MODE=live` — real agent (Portkey → vLLM, MCP tools). *Wired in later steps.*

## Build (in-cluster image)

```bash
docker build -t nychhc/copilot-backend:0.1.0 .   # single-stage UBI python-311
```
