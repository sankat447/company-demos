# IMPLEMENTATION_PLAN.md — Bir Festival 2026 App

Execution plan for Claude Code for the **Bir Festival 2026 app** — one event,
**21–23 November 2026**; the plan (and the product's planned life) ends **30 November
2026** with the close-out build. Work top-to-bottom; one PR per task ID; tick the box in
the same PR. Every phase ends with a **Gate** — do not start the next phase until the
gate's acceptance checks pass (`npm run typecheck && npm run lint && npm run test`,
plus the listed manual/e2e checks).

Target: **preview APK by end of Phase 3**, store-submission candidates by end of Phase 6.
Festival freeze: **7 November** (only P0 fixes after).

---

## Phase 0 — Repo bootstrap & contract plumbing

- [ ] **P0.1** Init Expo (TS strict), expo-router, ESLint/Prettier, Jest, Maestro skeleton;
      commit `CLAUDE.md`, docs/, `.easignore`.
- [ ] **P0.2** `schemas/stack-contract.schema.json` + `src/config/stack.ts` typed accessor + `npm run contract:check`; check in `config/stack-outputs.example.json`.
- [ ] **P0.3** Amplify v6 runtime configuration from contract (no CLI, no `amplify pull`);
      smoke test: unauthenticated AppSync health query.
- [ ] **P0.4** Design system: tokens from docs/BRAND.md (colors, spacing, type scale,
      flight-line divider component, paraglider spinner); Storybook-on-device screen.
- [ ] **P0.5** i18n scaffold (en/hi), locale switcher, Devanagari font check on both OSes.

**Gate 0:** app boots on Android emulator + iOS simulator, shows branded shell in
English & Hindi, `contract:check` green in CI.

## Phase 1 — Identity & roles

- [ ] **P1.1** Cognito OTP phone auth flow (enter phone → OTP → session), secure token
      storage, silent refresh, sign-out.
- [ ] **P1.2** Role resolution from Cognito groups → route gating (visitor/partner/
      volunteer tab sets); deep-link auth guard.
- [ ] **P1.3** Profile & consent screen driven by contract consent registry; DPDP copy
      in en+hi.

**Gate 1:** Maestro flow `auth-otp.yaml` passes on both platforms; tokens survive app
kill; wrong-OTP and offline-during-OTP paths handled.

## Phase 2 — Offline core (build this before any feature that depends on it)

- [ ] **P2.1** SQLite schema + migrations: `passes`, `revocations`, `scans`, `schedule`,
      `roster`, `outbox`, `kv`.
- [ ] **P2.2** Outbox engine: enqueue(mutation, idempotencyKey), FIFO drain per aggregate,
      retry w/ backoff+jitter, poison queue surfaced in a debug screen.
- [ ] **P2.3** JWKS fetch/cache/rotation (`passes.jwksPath`), ES256 verifier (pure-JS or
      quick native via `react-native-quick-crypto`), unit tests incl. expired/nbf/bad-kid.
- [ ] **P2.4** Delta sync jobs: schedule + revocations pull on foreground & on push nudge.

**Gate 2:** unit suite proves verify() <50 ms median on mid-range Android; airplane-mode
test: verifier accepts valid pass, rejects revoked one from cached list.

## Phase 3 — Visitor MVP (festival-critical path)

- [x] **P3.1** Tickets: browse tiers → payment (order via REST, provider SDK, webhook-
      confirmed via subscription) → pass stored → **QR pass screen** (brightness bump,
      wallet-style card, works offline).
- [x] **P3.2** Cultural nights: day tabs, venue map pins, reminders (local notifications),
      seat reservation (where applicable) + **audience-favourite voting** — votes power
      the award ceremonies and must be outbox-safe offline.
- [x] **P3.3** Home: "today at the festival" feed, **official fly-status banner +
      auto-refund state rendering** (SNS-driven; refund queue is backend-driven, the app
      renders state and notifies), SOS button (confirm → call + report location once
      with consent).
- [x] **P3.4** Push registration: FCM/APNs token → Pinpoint endpoint w/ role+locale
      attributes; quiet-hours preference UI.
- [ ] **P3.5** Preview channel build: `eas build --profile preview` universal APK;
      verify install-from-QR flow end-to-end using DISTRIBUTION.md §3.

**Gate 3:** e2e `buy-ticket.yaml` and `show-pass-offline.yaml` green; preview APK
installed on a physical device via the QR page; push received with app backgrounded.

## Phase 4 — Gate & volunteer operations

- [ ] **P4.1** Scanner screen (vision-camera): torch, haptic, <300 ms verdict, verdict
      reasons (expired/revoked/wrong-zone/duplicate), offline queue counter badge.
- [ ] **P4.2** Volunteer module: my roster, QR check-in/out (self + supervised), incident
      report (photo + category + offline-safe), certificate wallet.
- [ ] **P4.3** Gate-mode kiosk toggle (organiser-lite role): pinned scanner, screen-awake,
      battery saver hints.

**Gate 4:** field-sim test script: 200 mixed scans offline then sync — zero loss, zero
dupes server-side; incident with photo syncs after reconnect.

## Phase 5 — Marketplace, stalls & hospitality

- [ ] **P5.1** Experiences: browse/filter, detail, slots, book+pay, reviews
      (verified-booking only), host view for partners.
- [ ] **P5.2** Food/stalls: visitor food trail map + live wait chips (`ai.queuePredictPath`);
      partner stall console: application status, payments, daily analytics cards.
- [ ] **P5.3** Hospitality partner: allocations list, check-in flow, occupancy board
      (offline-render from cache).
- [ ] **P5.4** Food-street rules & clean-metrics screens: single-use-plastic-free and
      deposit-return rules surfaced in-app; daily waste figures rendered from the
      Cleanliness dashboard feed.
- [ ] **P5.5** Deposit-return points map (visitor-facing return-point locations).
- [ ] **P5.6** Highlights hub & catalog cache (CO-002): category hub + item lists rendered
      from the server-driven catalog (`highlights.catalogPath`, kv-cached offline; local
      mock fixture behind `flags.mockHighlights` until ASK #21 lands).
- [ ] **P5.7** Standard registration flow (CO-002): one shared engine — server-driven
      form schema + DPDP consent (+ guardian consent when flagged), free path queues in
      the outbox offline, paid path follows the webhook-confirmed order pattern
      (connectivity required; never fake a payment).
- [ ] **P5.8** Activity QR passes in wallet (CO-002): gate-checked confirmations deliver
      ES256 passes `typ:'activity'` into the existing offline wallet; verifier +
      revocation sync reused unchanged.
- [ ] **P5.9** My Registrations (CO-002): status chips (confirmed/waitlisted/pending),
      cancel where policy allows, add-to-calendar, offline QR passes.
- [ ] **P5.10** Category deltas (CO-002): slot picker (paragliding pilots, tour
      departures), weather-hold gate on paragliding CTA (official status + refund copy),
      Nov 23 view-only agenda, competitions "Rounds & judging" + voting link.

**Gate 5:** partner happy-paths pass on both OSes; experiences booking follows the
webhook-confirmation pattern verifiably (kill app between pay and confirm → state
recovers correctly). **CO-002 extension:** e2e `register-free-offline.yaml` and
`register-paid.yaml` green; weather-hold disables the paragliding CTA in sim.

## Phase 6 — AI, ops enhancements & polish

- [ ] **P6.1** AI Assistant: streaming chat (SSE), voice input (hi/en), FAQ offline
      fallback, "talk to a human" handoff deep link.
- [ ] **P6.2** AI Travel Planner: constraints form → 3-day festival itinerary cards →
      book-all fan-out.
- [ ] **P6.3** AI Translate: camera → menu/sign translation; cache; usage disclaimer.
- [ ] **P6.4** Crowd/queue view: venue heatmap tiles + best-time hints; landing-road
      shuttle ETA from Location tracker.
- [ ] **P6.5** Accessibility & perf pass: cold start ≤2.5 s (Android Go), bundle ≤40 MB,
      screen-reader walkthrough of ticket→gate journey.
- [ ] **P6.6** Store metadata: icons/splash (paraglider mark), screenshots (en+hi),
      privacy labels/Data Safety form drafts in `store/`.
- [ ] **P6.7** Shuttle live ETA screen: park-&-shuttle view from `geo.shuttleTrackerName`
      (+ `geo.shuttleEtaPath` once exported — BACKEND_ASKS #8); resident/school/patient
      priority messaging.
- [ ] **P6.8** Lost & found + child-reunite wristband flows: photo-based lost & found;
      QR wristband registration/lookup for family zones, lookup offline from cache
      (BACKEND_ASKS #10, #12).
- [ ] **P6.9** SOS + medical grid map: medical posts at Billing, Chogan and the main
      venue; evacuation-route info screen.

**Gate 6:** production builds (`--profile production`) succeed for both platforms;
internal testing tracks uploaded (Play Internal, TestFlight) per DISTRIBUTION.md.

## Phase 7 — Hardening, release & close-out

- [ ] **P7.1** Pen-test checklist run (pinning, secure storage, deeplink abuse, WebView-free).
- [ ] **P7.2** Load-shed drills: AppSync throttle simulation, subscription storm on
      fly-status hold, notification burst — app stays responsive.
- [ ] **P7.3** Release runbook executed once end-to-end (DISTRIBUTION.md §6), version
      1.0.0 tagged, EAS Update channel `production` verified with a trivial OTA fix.
- [ ] **P7.4** Rollback rehearsal: previous AAB re-promoted, direct-APK `latest` alias
      flipped back, OTA rollback published — timed under 30 minutes.
- [ ] **P7.5** Post-festival close-out build (24–30 Nov): certificates wallet issue
      (volunteer certificates within 7 days), vendor settlement status views (T+2 cycle),
      lost-&-found closure state, public-report deep link; `flags.festivalMode=false`
      renders the festival-concluded state.

**Gate 7 (GO/NO-GO, 7 Nov):** all e2e green on physical devices (1 low-end Android,
1 recent Android, 1 iPhone), crash-free sessions ≥99.5% on internal track for 7 days.

---

## Standing tasks (every phase)

- Update `docs/BACKEND_ASKS.md` immediately when a contract gap is found.
- Keep `hi.json` at 100% key parity (CI check).
- Add/extend a Maestro flow for every new user-visible journey.
- Screenshot diffs for design-system components on both platforms.

---

**End of plan.** The product's planned life ends **30 November 2026** after P7.5
close-out. There is no follow-on edition, no post-2026 roadmap, and no further KPIs
beyond Gate 7 and the close-out duties above.
