# Frontend — NYC H+H Streamlit role app

Branded role UIs + embedded copilot chat. Talks to the backend's data API (JSON) and
chat SSE. FOR DEMONSTRATION ONLY — SYNTHETIC DATA.

## Tabs ↔ requirements

| Tab | DR | Source |
|-----|----|--------|
| Dashboard | DR-10 + alert DR-08/09 | `/api/data/coverage`, `/api/data/appointments/risk`, `/api/data/pto` |
| Schedule | DR-02 | `/api/data/schedule` |
| No-Show Risk | DR-06 | `/api/data/appointments/risk` |
| PTO | DR-05 | `/api/data/pto` + `/pto/{id}/decision` |
| Copilot | DR-11 | `/api/chat` (SSE) |

Role switch = DR-01 (sidebar); the role is passed to the copilot for in-context answers.

## Run locally

```bash
# 1) backend (echo or live) on :8088
cd ../backend && source .venv/bin/activate
uvicorn nychhc_copilot.main:app --port 8088 &

# 2) frontend
cd ../frontend
pip install -r requirements.txt
NYCHHC_BACKEND_URL=http://localhost:8088 streamlit run app.py
```

## Branding

`theme.py` holds the NYC H+H palette (deep purple + accents) — **approximated**;
replace with exact brand-guide hex when available. Mandatory disclaimer banner on
every page.

## Deploy

Built by `deploy.sh` to ECR repo `nychhc/frontend`; manifests in
`gitops/manifests/70-*`. `NYCHHC_BACKEND_URL` points at the backend Service.
