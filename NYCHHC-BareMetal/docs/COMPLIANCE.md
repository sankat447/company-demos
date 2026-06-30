# Compliance & "What Changes for Production"

> ⚠️ **FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA.**

This is the document NYC Health + Hospitals stakeholders **will** ask about. It is
deliberately blunt about what this demo is **not**. Nothing here is a defect — these
are conscious shortcuts to ship a compelling 15-minute demo. Each row states what we
did for the demo and **what would have to change for a real, PHI-handling deployment**.

## The one-sentence version

> This demo proves the *platform and agentic workflow* on **synthetic data**. It is
> **not** HIPAA-compliant, is **not** covered by a BAA, and must **never** be pointed
> at real patient or staff data as-is.

## What is NOT production-ready

| Area | Demo shortcut | What production requires |
|------|---------------|--------------------------|
| **PHI / PII** | No real PHI; all data synthetic. De-identification **skipped** (nothing real to scrub). | Presidio or the platform's Vault-backed transformation service on every inbound free-text field; documented PHI data-flow map; minimum-necessary access. |
| **HIPAA** | Out of scope. No Security Rule / Privacy Rule controls asserted. | Full Security Rule technical safeguards, risk analysis, workforce training, sanction policy. |
| **BAA** | None. Bedrock/Portkey/any external LLM path is **not** under a Business Associate Agreement. | Executed BAAs with every entity that could touch PHI; or keep all PHI on in-VPC vLLM only, with Bedrock disabled for PHI. |
| **Audit retention** | MongoDB audit log has **no retention SLA**, no tamper-evidence, no legal hold. | WORM/append-only audit store, defined retention (often 6 yr), tamper-evidence, access logging of the audit log itself. |
| **AuthZ depth** | Keycloak roles gate *UI views and tool access*; not row-level/data-scoped. | Attribute-based access (dept/facility scoping), break-glass, periodic access review. |
| **Model accuracy** | Predictive models trained on **synthetic** data → metrics are illustrative only. | Validation on real, representative data; bias/fairness eval (TrustyAI); clinical/operational sign-off; monitored drift. |
| **LLM hallucination** | RAG + citations + "human approval for writes" reduce but do **not** eliminate. | Human-in-the-loop on all consequential actions (already designed), evaluation harness, guardrail thresholds tuned, abstention behavior. |
| **Schedule writes** | Agent only **proposes**; a human approves via n8n. No real HRIS/payroll write. | Integration contracts with HRIS/payroll, change auditing, rollback, union/labor-rule validation. |
| **Secrets** | Vault in **dev mode** (root token in cluster). | Vault in HA/production mode, proper auth backends, secret rotation, no root token. |
| **Network** | Demo namespace **outside** the service mesh (no mTLS between demo pods). | Mesh membership + mTLS, NetworkPolicies, egress control to AWS. |
| **Data sources** | CDC/NIH/AHRQ public docs + synthetic policies. | Licensed/owned clinical content, governance over what the model may cite. |

## Guardrails that ARE in the demo (and carry to production)

These are real, not theater — they're the parts worth keeping:

- **All LLM calls routed through Portkey** → PII detection, jailbreak blocking,
  unified audit, cost tracking, model fallback. (Lesson L5)
- **Human approval required before any schedule write.** The agent proposes; a
  person confirms. No autonomous consequential action.
- **Every action audited** to MongoDB; every LLM call traced via Portkey + OTLP.
- **Citations on policy claims** via RAG over a known corpus.
- **Disclaimer banner** on every page and every API response. (Lesson L10)
- **OIDC authentication** (Keycloak) with role-scoped access. (Req 4.1)

## "If we did this for real" — rough delta

1. Sign BAAs / restrict PHI to in-VPC vLLM; disable external fallback for PHI.
2. Add de-identification (Presidio / Vault transformation) on all free-text.
3. Replace synthetic data with governed, validated real data; re-train + bias-eval.
4. Harden Vault, join the mesh, add NetworkPolicies, WORM audit store.
5. Independent clinical/operational + privacy/security review and sign-off.
6. Production SLAs: retention, availability, drift monitoring, incident response.

## Stakeholder Q&A (preview — full version in DEMO_SCRIPT.md)

- *"Is this using real patient data?"* — **No.** 100% synthetic, labeled on every screen.
- *"Could it hallucinate a recommendation?"* — Mitigated by RAG citations and
  **mandatory human approval before any action**; never autonomous.
- *"What about HIPAA / BAA?"* — Out of scope for the demo; section above lists exactly
  what closing that gap requires.
- *"How much does it cost to run?"* — Portkey tracks per-call cost; shown in Grafana.
- *"How long to production?"* — Driven by the deltas above, not by the demo code.
