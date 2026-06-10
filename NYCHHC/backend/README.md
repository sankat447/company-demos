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
├── llm/             # Portkey gateway client (L5) — primary + fallback
├── agent/           # Copilot interface · EchoCopilot · ReActCopilot (LangChain 1.x)
├── tools/           # query_workforce_db / no_show_risk / coverage_forecast /
│   └── providers/   #   propose_schedule_change — fake (SQLite) + live (psycopg/httpx)
├── mcp_server.py    # same tools re-exposed over MCP for external consumers (+add)
└── api/             # routes (/health, /api/capabilities, /api/chat SSE) + schemas
```

## Modes

- `NYCHHC_MODE=echo` (default) — EchoCopilot, no external deps.
- `NYCHHC_MODE=live` — LangChain ReAct agent (Portkey → vLLM). With no Aurora DSN set
  it still runs against the **offline fakes** (SQLite + canned models), so you can
  drive the full agent locally; set the real endpoints to hit the cluster.

The two predictive models degrade gracefully: if a KServe endpoint is unreachable,
the model provider falls back to the rules model (confirmed design D5).

## MCP server (external tool surface)

```bash
python -m nychhc_copilot.mcp_server     # stdio; exposes the 4 workforce tools
```

The in-process agent binds these tools directly (latency + demo reliability); the
MCP server is the *same* logic for Open WebUI / other agents.

## Build (in-cluster image)

```bash
docker build -t nychhc/copilot-backend:0.1.0 .   # single-stage UBI python-311
```
