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

> **Status update (2026-09-03).** Two tracks now run in parallel. **Track A** below is
> the mobile client — Phases 0–4 are complete, plus the CO-002 (Highlights) and CO-003
> (lodging & badges) extensions in Phases 5–6. **Track B** (new, at the end of this file)
> is the AWS backend: the original plan assumed the backend "already existed elsewhere",
> but it is now the sibling **`bir-backend`** Terraform project (deployed, us-east-1). Its
> AppSync resolvers and Lambda bodies are still being wired, so the client runs on the
> `flags.mock*` fixtures until each domain's resolver lands — flipping those off, domain by
> domain, is the current critical path. A self-contained **demo/evaluation build** (example
> contract → OTP `123456`, all roles, mocks on, payments off) is published for testing via
> the QR page, and organizers collect real seed data through
> `bir-backend/data-collection/Bir_Festival_2026_Data_Collection.xlsx`.

## Phase 0 — Repo bootstrap & contract plumbing

- [x] **P0.1** Init Expo (TS strict), expo-router, ESLint/Prettier, Jest, Maestro skeleton;
      commit `CLAUDE.md`, docs/, `.easignore`.
- [x] **P0.2** `schemas/stack-contract.schema.json` + `src/config/stack.ts` typed accessor + `npm run contract:check`; check in `config/stack-outputs.example.json`.
- [x] **P0.3** Amplify v6 runtime configuration from contract (no CLI, no `amplify pull`);
      smoke test: unauthenticated AppSync health query.
- [x] **P0.4** Design system: tokens from docs/BRAND.md (colors, spacing, type scale,
      flight-line divider component, paraglider spinner); Storybook-on-device screen.
- [x] **P0.5** i18n scaffold (en/hi), locale switcher, Devanagari font check on both OSes.

**Gate 0:** app boots on Android emulator + iOS simulator, shows branded shell in
English & Hindi, `contract:check` green in CI.

## Phase 1 — Identity & roles

- [x] **P1.1** Cognito OTP phone auth flow (enter phone → OTP → session), secure token
      storage, silent refresh, sign-out.
- [x] **P1.2** Role resolution from Cognito groups → route gating (visitor/partner/
      volunteer tab sets); deep-link auth guard.
- [x] **P1.3** Profile & consent screen driven by contract consent registry; DPDP copy
      in en+hi.

**Gate 1:** Maestro flow `auth-otp.yaml` passes on both platforms; tokens survive app
kill; wrong-OTP and offline-during-OTP paths handled.

## Phase 2 — Offline core (build this before any feature that depends on it)

- [x] **P2.1** SQLite schema + migrations: `passes`, `revocations`, `scans`, `schedule`,
      `roster`, `outbox`, `kv`.
- [x] **P2.2** Outbox engine: enqueue(mutation, idempotencyKey), FIFO drain per aggregate,
      retry w/ backoff+jitter, poison queue surfaced in a debug screen.
- [x] **P2.3** JWKS fetch/cache/rotation (`passes.jwksPath`), ES256 verifier (pure-JS or
      quick native via `react-native-quick-crypto`), unit tests incl. expired/nbf/bad-kid.
- [x] **P2.4** Delta sync jobs: schedule + revocations pull on foreground & on push nudge.

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
- [~] **P3.5** Preview channel build: `eas build --profile preview` universal APK;
  verify install-from-QR flow end-to-end using DISTRIBUTION.md §3.
  _Partial: a local-gradle **evaluation APK** ships via the S3/QR page (install-from-QR
  verified on device + emulator); the EAS `preview` profile build is still to run._

**Gate 3:** e2e `buy-ticket.yaml` and `show-pass-offline.yaml` green; preview APK
installed on a physical device via the QR page; push received with app backgrounded.

## Phase 4 — Gate & volunteer operations

- [x] **P4.1** Scanner screen (vision-camera): torch, haptic, <300 ms verdict, verdict
      reasons (expired/revoked/wrong-zone/duplicate), offline queue counter badge.
- [x] **P4.2** Volunteer module: my roster, QR check-in/out (self + supervised), incident
      report (photo + category + offline-safe), certificate wallet.
- [x] **P4.3** Gate-mode kiosk toggle (organiser-lite role): pinned scanner, screen-awake,
      battery saver hints.

**Gate 4:** field-sim test script: 200 mixed scans offline then sync — zero loss, zero
dupes server-side; incident with photo syncs after reconnect.

## Phase 5 — Marketplace, stalls & hospitality

- [ ] **P5.1** Experiences: browse/filter, detail, slots, book+pay, reviews
      (verified-booking only), host view for partners.
- [x] **P5.2** Food/stalls: visitor food trail map + live wait chips (`ai.queuePredictPath`);
      partner stall console: application status, payments, daily analytics cards.
- [x] **P5.3** Hospitality partner: allocations list, check-in flow, occupancy board
      (offline-render from cache).
- [ ] **P5.4** Food-street rules & clean-metrics screens: single-use-plastic-free and
      deposit-return rules surfaced in-app; daily waste figures rendered from the
      Cleanliness dashboard feed.
- [ ] **P5.5** Deposit-return points map (visitor-facing return-point locations).
- [x] **P5.6** Highlights hub & catalog cache (CO-002): category hub + item lists rendered
      from the server-driven catalog (`highlights.catalogPath`, kv-cached offline; local
      mock fixture behind `flags.mockHighlights` until ASK #21 lands).
- [x] **P5.7** Standard registration flow (CO-002): one shared engine — server-driven
      form schema + DPDP consent (+ guardian consent when flagged), free path queues in
      the outbox offline, paid path follows the webhook-confirmed order pattern
      (connectivity required; never fake a payment).
- [x] **P5.8** Activity QR passes in wallet (CO-002): gate-checked confirmations deliver
      ES256 passes `typ:'activity'` into the existing offline wallet; verifier +
      revocation sync reused unchanged.
- [x] **P5.9** My Registrations (CO-002): status chips (confirmed/waitlisted/pending),
      cancel where policy allows, add-to-calendar, offline QR passes.
- [x] **P5.10** Category deltas (CO-002): slot picker (paragliding pilots, tour
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

- [x] **P6.10** Room inventory CRUD (CO-003): admin/lodging/rooms list+filters, add,
      edit/retire; validation (capacity ≥1, double ⇒ capacity 2, duplicate guard on
      hotel+label, 20–24 Nov per-night availability editor).
- [x] **P6.11** Allocation engine + unit suite (CO-003): pure deterministic
      propose(pool, rooms, nights); gender-sharing hard constraints, couples-exclusive
      double rooms, undisclosed/other → manual queue; property-based tests.
- [x] **P6.12** Allocation workflow UI (CO-003): review pool → auto-allocate proposal →
      adjust w/ inline constraint blocks (EN+HI) → commit (idempotent mutation) →
      occupancy board (offline cache) + printable per-hotel roster.
- [x] **P6.13** Participant badge (CO-003): typ:'participant' wallet pass, branded badge
      screen, PNG export + admin bulk print PDF; auto-issue on confirmed+lodging-resolved.
- [x] **P6.14** Notifications & change management (CO-003): post-commit reassignment with
      re-checks + re-notify; cancellation frees beds; lodging card in My Registrations.

**Gate 6:** production builds (`--profile production`) succeed for both platforms;
internal testing tracks uploaded (Play Internal, TestFlight) per DISTRIBUTION.md.
**CO-003 extension:** engine property tests prove constraints §3.1–3.4 hold for 1,000
randomized pools; manual-queue path e2e `lodging-manual-place.yaml` green; badge QR
verifies on the offline scanner.

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

## Track B — Backend implementation (`../bir-backend`)

New since the original plan, which assumed a pre-existing backend. The backend is now the
sibling **`bir-backend`** Terraform project. Provisioning lives there, never in
`bir-mobile`. Each domain task ends by **flipping its `flags.mock*` off and re-verifying
the client against live data** — that is the acceptance test. Privileged mutations MUST
re-check the Cognito group server-side and audit-log overrides (`actorNote`).

- [x] **B0** Infra: Terraform stack (Cognito + 6 role groups + Identity Pool, AppSync,
      DynamoDB single-table w/ streams + PITR, S3 + CloudFront, 4 Lambdas, SSM), one-command
      `deploy.sh`/`destroy.sh`, tag-scoped teardown, cost estimate; ES256 key → SSM, JWKS
      published; health smoke; seed data. **Deployed** (acct 406337554361, us-east-1).
- [ ] **B1** Highlights domain live: AppSync resolvers for `highlightsCatalog`,
      `createRegistration`, `cancelRegistration` over DynamoDB; publish the catalog to
      `highlights.catalogPath`; **flip `mockHighlights` off** (ASKs #21–26). ← _start here_
- [ ] **B2** Lodging & badges domain live: `lodgingPool`/`lodgingOccupancy`/`commitAllocation`
      (server re-validates the §3 constraints, `admin-hospitality`-guarded) + `issueBadge`;
      **flip `mockLodging` off** (ASKs #27–32).
- [x] **B3** Volunteer domain live: `volunteerRoster`/`recordAttendance`/`reportIncident`
      resolvers (VTL-direct on the table; roster keyed by the caller's own sub;
      attendance/incident idempotent on the outbox key). Deployed + verified
      end-to-end with a real volunteer-group Cognito token (roster returns the
      caller's profile, both mutations persist + are idempotent). `mockVolunteer`
      stays on for the offline demo/eval build; flip off in the live contract
      for on-device live runs (ASKs #33–34; #34 photo signed-URL upload deferred).
- [x] **B4** Partner domain live: `stallConsole`/`hospitalityConsole` resolvers (VTL-direct
      GetItem keyed by the caller's own sub, `partner`-group guarded; analytics/allocations
      stored as native lists, coerced to AWSJSON on output and parsed client-side). Deployed + verified end-to-end with a real partner-group token (both consoles return; AWSJSON
      round-trips; a non-partner token is rejected `Unauthorized`). `mockPartner` stays on
      for the offline demo/eval build; flip off in the live contract for on-device runs.
- [x] **B5** Payments path end-to-end on **Paytm** (UPI/cards/netbanking/wallet): HTTP API
      `POST /pay/order` (`create-order` Lambda, Cognito-authorized, server-side pricing →
      Paytm Initiate Transaction → txnToken) + `getOrder`/`confirmOrder` resolvers;
      `payment-webhook` verifies the Paytm checksum, re-checks the Order Status API, mints
      passes via `pass-signer` (`issuePass`), and invokes server-only `confirmOrder` →
      `onOrderConfirmed`. Client: `paytmProvider` (All-in-One SDK) behind the provider seam,
      contract `payments.provider=paytm`. Deployed + verified (auth/pricing/503-creds-gate,
      getOrder owner-scope, confirmOrder IAM-only fan-out, checksum round-trip). **Merchant
      key/MID are provisioned by the operator in SSM** — see docs/PAYMENTS_PAYTM.md; real
      Paytm calls + a paid txn await that. Supersedes the Razorpay ASKs #14/#15.
- [ ] **B6** Auth + pass Lambda bodies: `custom-auth` real random OTP over SNS SMS;
      `pass-signer` `issuePass`/`issueBadge`/`revoke`; revocations delta feed.
- [ ] **B7** Data importer: `bir-backend/data-collection` workbook → DynamoDB seed rows
      (dates/times → epoch, cross-sheet id resolution) + Cognito users & role-group
      membership for the Users & Roles tab.
- [ ] **B8** AI endpoints: REST API GW + Lambda → Bedrock for `ai.assistantPath`,
      `ai.plannerPath`, `ai.translatePath`, `ai.queuePredictPath` (unblocks P6.1–6.4).
- [ ] **B9** Push + geo services: Pinpoint app + FCM/APNs platform endpoints (`push.*`);
      Location Service geofences + shuttle tracker (`geo.*`).
- [ ] **B10** Ops resolvers: `recordScan`, `setFlyStatus` (`safety-officer`-guarded) + SNS
      fly-status fanout + refund auto-queue.

**Gate B:** for each domain, the client runs with its `mock*` flag OFF against the live
stack (`contract:check` green on the emitted `stack-outputs.json`); every privileged
mutation is rejected for the wrong Cognito group in a direct API test; the self-contained
demo/eval build (mocks on, example contract) still works unchanged for offline testing.

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
