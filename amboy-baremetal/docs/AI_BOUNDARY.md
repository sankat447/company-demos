# Amboy — Where AI Is (and Isn't)

Each component classified against the **actually-deployed** stack, so the demo
can state precisely where intelligence is applied and where it is not.

**Legend**
- 🟣 **LLM** — generative AI, the only external egress (Portkey → Anthropic Claude)
- 🔵 **ML model** — on-cluster, no egress (Presidio NER, MiniLM embeddings)
- ⚪ **No AI** — deterministic code · cryptography · rules · storage · human

## By zone

| Zone | AI here? | Components |
|---|---|---|
| **1 · Privacy gate** | ML assists; **no LLM** | 🔵 Presidio NER · ⚪ regex recognizers (SSN/phone/email/address/**account**) · ⚪ Vault HMAC+encrypt · 🔵 MiniLM embeddings · ⚪ pgvector write |
| **2 · Deterministic** | **No AI** | ⚪ fact extraction · ⚪ delta/ratio calc · ⚪ policy flags & scenario · ⚪ grounding guard |
| **3 · AI narration** | **LLM (only zone)** | ⚪ RAG retrieve (pgvector cosine) · 🟣 LLM narrate (Claude via Portkey) · ⚪ guardrails = prompt rules + grounding check |
| **4 · Human judgment** | **No AI** | ⚪ human review/approve (n8n routes) · ⚪ gated reveal (Keycloak role + Vault decrypt) |
| **5 · Regulatory review** | **No AI** | ⚪ audit read/export (SQL + Grafana over signed rows) |

## Component-by-component

| Component | Class | Why |
|---|---|---|
| Presidio analyzer | 🔵 ML (on-cluster) | NER detects PERSON/LOCATION; no egress |
| Regex recognizers | ⚪ No AI | Deterministic patterns — the guaranteed floor |
| Vault transit (HMAC/encrypt) | ⚪ No AI | Cryptographic tokenization + reversible encryption |
| MiniLM embeddings | 🔵 ML (on-cluster) | Retrieval vectors; baked in image, no egress |
| metrics-engine | ⚪ No AI | Pure-Python compare/scenario/flag thresholds |
| pgvector retrieval | ⚪ No AI | Cosine-distance query (math) over token-only chunks |
| compare-agent → Portkey → Claude | 🟣 LLM (egress) | Generative narration + document figure-extraction; the only egress |
| Grounding guard | ⚪ No AI | Rejects any narrated number not present in tool output |
| Keycloak / gated reveal | ⚪ No AI | Role check + Vault decrypt in the app tier |
| Audit log · Grafana · n8n | ⚪ No AI | Append-only storage, dashboards, human-approval workflow |

## One-line story

Generative AI (an LLM) is used in **Zone 3 only**, and only to **narrate numbers
deterministic code already computed** — it cannot calculate a figure and never
sees NPI (only opaque tokens). On-cluster **ML** (Presidio + MiniLM) assists
detection & retrieval in **Zone 1**, with no egress and only over data about to be
tokenized. **Zones 2, 4 and 5 use no AI** — deterministic math, cryptography,
human judgment, audit.

## Accuracy notes (don't overstate in the demo)

- Narration is **Portkey → Anthropic Claude**, *not* vLLM; guardrails are a
  **deterministic grounding check + Presidio de-identification**, *not* NeMo Guardrails.
- Compliance-framework labels (GLBA, SR 26-2, ECOA/FCRA, NIST AI RMF, …) are
  **illustrative mappings**, not certified controls.
