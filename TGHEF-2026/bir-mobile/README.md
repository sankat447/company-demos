# bir-mobile

Cross-platform client (Expo React Native, TypeScript strict) for the
**Bir Festival 2026 app** — one event, **21–23 November 2026** — visitor, partner
and volunteer roles in one binary, shipping to Google Play, the App Store, and the
direct-QR APK channel (the primary festival-week onboarding channel) on the
existing AWS stack. Product life ends 30 November 2026 with close-out (CO-001).

Read first: [CLAUDE.md](CLAUDE.md) → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) →
[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) →
[docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

## Quick start

```bash
npm install                 # also seeds config/stack-outputs.json from the example
npm run contract:check      # validate the stack contract binding
npm run start               # expo dev client
npm run typecheck && npm run lint && npm run test
```

Point the app at a real environment by replacing `config/stack-outputs.json`
with the backend stack's exports (the pipeline does this in CI). The file is
gitignored; the schema is the source of truth.

## What's implemented (Phase 0 + Phase 2 core)

- **Contract plumbing** — `schemas/stack-contract.schema.json`,
  `src/config/stack.ts` typed accessor, `npm run contract:check` (P0.2).
- **Amplify v6 runtime config** from the contract, tokens in secure storage —
  no `amplify pull`, no hardcoded IDs (P0.3).
- **Design system** — brand tokens, flight-line divider, paraglider spinner
  (P0.4); **i18n** en/hi with CI parity check (P0.5).
- **Auth skeleton** — Cognito OTP custom-auth flow + role resolution from
  Cognito groups gating visitor/partner/volunteer route groups (P1.1–P1.2).
- **Offline core** — SQLite schema/migrations, outbox engine (FIFO per
  aggregate, backoff+jitter, poison queue), ES256 JWKS-pinned pass verifier,
  delta-sync jobs, gate verdict pipeline (P2.1–P2.4, ARCHITECTURE.md §6).
- **QR pass screen** rendering from SQLite with brightness bump (P3.1 slice).
- **Distribution** — `eas.json` profiles, `scripts/publish-direct.ts`,
  GitHub Actions (`ci`, `preview`, `release`, `e2e`), Maestro flow skeletons.

Deliberately deferred (per bundle-discipline rule 7, added in their plan PRs):
`react-native-vision-camera` (P4.1), `react-native-razorpay` (P3.1),
`react-native-maps` (P3.2), push/Pinpoint wiring (P3.4).

## Assets

`assets/` currently holds generated placeholder marks; replace with the real
paraglider icon/splash set from the brand team before store submission (P6.6).
