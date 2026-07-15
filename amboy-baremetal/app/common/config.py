"""Central env-driven config for all Amboy roles.

Every external dependency is a reused baremetal-stack service addressed by its
in-cluster Service DNS (http east-west; the self-signed wildcard TLS only fronts
the UI Route). Defaults match ai-demo-stack-baremetal; deploy.sh injects secrets.
"""
import os


def _b(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


# ── Postgres + pgvector (iis-ai-data) ────────────────────────────────────────
PG_HOST = _b("AMBOY_PG_HOST", "iis-ai-postgres-primary.iis-ai-data.svc")
PG_PORT = int(_b("AMBOY_PG_PORT", "5432"))
PG_DB = _b("AMBOY_PG_DB", "rhoai_demo")
PG_USER = _b("AMBOY_PG_USER", "rhoai_admin")
PG_PASSWORD = _b("AMBOY_PG_PASSWORD", "Demo1234#")


def pg_dsn() -> str:
    return (f"host={PG_HOST} port={PG_PORT} dbname={PG_DB} "
            f"user={PG_USER} password={PG_PASSWORD}")


# ── MinIO / S3 (iis-ai-data) ─────────────────────────────────────────────────
S3_ENDPOINT = _b("AMBOY_S3_ENDPOINT", "http://minio.iis-ai-data.svc:9000")
S3_ACCESS_KEY = _b("AMBOY_S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = _b("AMBOY_S3_SECRET_KEY", "Demo1234#")
S3_BUCKET_RAW = _b("AMBOY_S3_BUCKET_RAW", "amboy-raw")     # contains NPI — never read by LLM path
S3_BUCKET_DEID = _b("AMBOY_S3_BUCKET_DEID", "amboy-deid")  # de-identified only

# ── Portkey LLM gateway (iis-ai-ai) — the TRUST BOUNDARY (egress) ─────────────
PORTKEY_BASE_URL = _b("AMBOY_PORTKEY_BASE_URL", "http://portkey.iis-ai-ai.svc:8787/v1")
PORTKEY_API_KEY = _b("AMBOY_PORTKEY_API_KEY", "")          # virtual key, injected by deploy
LLM_MODEL = _b("AMBOY_LLM_MODEL", "gpt-4o-mini")           # routed by Portkey; Claude via Portkey also OK
# Anthropic REQUIRES max_tokens on every request — must be set or Portkey 400s.
LLM_MAX_TOKENS = int(_b("AMBOY_LLM_MAX_TOKENS", "1024"))

# ── Vault transit (iis-ai-system) — reversible HMAC tokenization ──────────────
VAULT_ADDR = _b("AMBOY_VAULT_ADDR", "http://vault.iis-ai-system.svc:8200")
VAULT_TOKEN = _b("AMBOY_VAULT_TOKEN", "Demo1234#")          # DEV-mode root token (demo only)
VAULT_TRANSIT_KEY = _b("AMBOY_VAULT_TRANSIT_KEY", "amboy-npi-tokenize")

# ── Local PII/NPI detection model (iis-ai-ai) — Piiranha/DeBERTa, CPU ─────────
PII_MODEL_URL = _b("AMBOY_PII_MODEL_URL", "http://amboy-pii-model.iis-ai-ai.svc:8080")

# ── Presidio official CPU services (iis-ai-ai) ───────────────────────────────
PRESIDIO_ANALYZER_URL = _b("AMBOY_PRESIDIO_ANALYZER_URL", "http://amboy-presidio-analyzer.iis-ai-ai.svc:3000")
PRESIDIO_ANONYMIZER_URL = _b("AMBOY_PRESIDIO_ANONYMIZER_URL", "http://amboy-presidio-anonymizer.iis-ai-ai.svc:3000")

# ── Keycloak OIDC (iis-ai-system) — npi-reveal role gates /detokenize ─────────
KEYCLOAK_URL = _b("AMBOY_KEYCLOAK_URL", "http://keycloak.iis-ai-system.svc:8080")
KEYCLOAK_REALM = _b("AMBOY_KEYCLOAK_REALM", "amboy")
NPI_REVEAL_ROLE = _b("AMBOY_NPI_REVEAL_ROLE", "npi-reveal")
# DEMO GAP: when "1", /detokenize trusts the X-Amboy-Roles header instead of a
# verified JWT signature (Keycloak realm/clients not always provisioned in demo).
AUTH_DEV_MODE = _b("AMBOY_AUTH_DEV_MODE", "1") == "1"

# ── Other reused services ────────────────────────────────────────────────────
MLFLOW_URL = _b("AMBOY_MLFLOW_URL", "http://mlflow.iis-ai-system.svc:5000")
METRICS_ENGINE_URL = _b("AMBOY_METRICS_ENGINE_URL", "http://amboy-metrics-engine.iis-ai-ai.svc:8080")
DEID_GATEWAY_URL = _b("AMBOY_DEID_GATEWAY_URL", "http://amboy-deid-gateway.iis-ai-ai.svc:8080")
COMPARE_AGENT_URL = _b("AMBOY_COMPARE_AGENT_URL", "http://amboy-compare-agent.iis-ai-ai.svc:8080")

# Local CPU embedding model (baked into the image).
EMBED_MODEL = _b("AMBOY_EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
