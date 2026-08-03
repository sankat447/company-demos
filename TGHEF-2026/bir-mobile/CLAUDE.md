# CLAUDE.md — Bir Platform Mobile Apps (Android + iOS)

> Drop this file at the repo root. Claude Code reads it on every session.
> Companion docs: `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/DISTRIBUTION.md`.

## What this repo is

The cross-platform mobile client for **The Official Digital Platform of Bir** — the festival
(21–23 Nov) and year-round destination app. One codebase ships:

1. **Android AAB** → Google Play (primary channel for the valley's Android-majority users)
2. **Android universal APK** → direct download from our CloudFront domain via QR code
   ("untrusted"/sideload channel for festival week and low-connectivity onboarding)
3. **iOS IPA** → App Store + TestFlight (ad-hoc OTA install via QR only for registered
   test devices — see DISTRIBUTION.md for Apple's constraints)

The AWS backend **already exists in a separate project/stack**. This repo NEVER creates
backend resources. It consumes them through the stack contract (`config/stack-outputs.json`).
If a capability seems missing from the contract, STOP and add it to
`docs/BACKEND_ASKS.md` instead of provisioning anything.

## Stack & toolchain (fixed decisions — do not re-litigate)

- **Framework:** React Native via **Expo SDK (latest stable), TypeScript strict**.
  Managed workflow + `expo prebuild` where native modules require it.
- **Builds:** **EAS Build** for AAB/APK/IPA; **EAS Update** for OTA JS updates.
  `eas.json` profiles: `development`, `preview` (internal QR APK), `production`.
- **AWS client:** **Amplify JS v6 libraries only** (`aws-amplify`), configured at runtime
  from `config/stack-outputs.json` — never from hardcoded IDs, never via `amplify pull`.
- **Auth:** Cognito User Pool (OTP-first phone auth) + Identity Pool for scoped S3/AppSync access.
- **API:** AppSync GraphQL (codegen types in `src/api/generated/`) + REST via API Gateway
  for payment webhooks/callbacks. All AI features go through backend endpoints
  (API GW → Lambda → Bedrock). The app NEVER holds model keys or calls Bedrock directly.
- **State/offline:** TanStack Query for server state, Zustand for UI state,
  **SQLite (expo-sqlite) + outbox pattern** for offline-first modules (tickets, scans,
  volunteer attendance). AppSync subscriptions for live schedules/alerts.
- **Navigation:** Expo Router (file-based).
- **Payments:** UPI intent flow via Razorpay/Cashfree SDK behind `src/payments/provider.ts`
  interface — the concrete provider is injected per stack contract flag.
- **Push:** FCM (Android) / APNs (iOS) registered against **Amazon Pinpoint / SNS platform
  endpoints** exposed by the backend stack.
- **Maps:** `react-native-maps` with Google provider on Android, Apple Maps on iOS;
  venue geofences from backend config, not hardcoded coordinates.
- **QR:** `react-native-vision-camera` + frame processor for scanning;
  pass rendering via `react-native-qrcode-svg`. Offline validation per ARCHITECTURE.md §6.

## Commands

```bash
npm run start            # expo start (dev client)
npm run typecheck        # tsc --noEmit — must pass before any commit
npm run lint             # eslint + prettier check
npm run test             # jest unit tests
npm run test:e2e         # maestro flows (see .maestro/)
npm run codegen          # regenerate GraphQL types from schema in contract
npm run build:preview    # eas build --profile preview --platform android (QR APK)
npm run build:prod       # eas build --profile production --platform all
npm run contract:check   # validates config/stack-outputs.json against schemas/stack-contract.schema.json
```

## Hard rules

1. **Contract first.** Any code touching AWS reads `config/stack-outputs.json` through
   `src/config/stack.ts` (typed accessor). Run `npm run contract:check` after editing.
2. **Offline is a feature, not a fallback.** Gate entry scanning, ticket display, volunteer
   attendance, and the day's schedule must work with airplane mode on. Write the offline
   test before the online one.
3. **Hindi is first-class.** Every user-facing string goes through i18n (`src/i18n/`),
   keys in English, `hi.json` filled in the same PR. No hardcoded strings in JSX.
4. **No secrets in the repo.** Signing keys/keystores live in EAS secrets; API keys come
   from the backend at runtime. `.easignore` and `.gitignore` are enforced in CI.
5. **DPDP discipline.** Collect only fields the contract's consent registry lists. No
   third-party analytics SDKs — analytics events go to the backend's Pinpoint/Kinesis
   endpoint only.
6. **Accessibility floor:** touch targets ≥44pt, dynamic type respected, every icon
   button has `accessibilityLabel` (English + Hindi).
7. **Bundle discipline:** production Android AAB ≤ 40 MB download size. Check with
   `npx expo export` size report before adding any dependency; heavy assets stream from
   CloudFront, never ship in the binary.
8. **One PR = one plan task.** Reference the task ID from IMPLEMENTATION_PLAN.md in the
   PR title. Update the plan checkbox in the same PR.

## Repo layout

```
app/                    # expo-router routes (visitor + partner + volunteer role gates)
src/
  api/                  # AppSync client, generated types, REST clients
  config/               # stack.ts (contract accessor), feature flags
  features/             # feature modules: tickets/ schedule/ stalls/ experiences/
                        #   volunteers/ hospitality/ ai-assistant/ payments/ sos/
  offline/              # sqlite schema, outbox, sync engine, signed-pass verifier
  i18n/                 # en.json, hi.json (+ bo.json, pah audio manifest later)
  ui/                   # design system: tokens from docs/BRAND.md, components
config/stack-outputs.json     # ← the ONLY binding to the AWS project (gitignored; example checked in)
schemas/stack-contract.schema.json
docs/                   # ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, DISTRIBUTION.md, BACKEND_ASKS.md, BRAND.md
.maestro/               # e2e flows: buy-ticket, scan-gate-offline, volunteer-checkin
```

## Brand (summary — full tokens in docs/BRAND.md)

Palette: ink `#17232B`, pine `#2E5E4E`, slate `#3E6B8C`, marigold `#E8A13D`,
flag-red `#B4482B`, paper `#F7F8F5`. Motif: the Billing→Bir "flight line" (dashed
descending arc) used in headers/empty states; paraglider mark as the app icon base.
Type: serif display for headings (Fraunces via expo-font), system sans for body.

## When unsure

Prefer the smaller diff. Prefer the offline-safe path. Prefer asking via
`docs/BACKEND_ASKS.md` over inventing backend behavior. Never mock a payment or a
safety alert in production code paths.
