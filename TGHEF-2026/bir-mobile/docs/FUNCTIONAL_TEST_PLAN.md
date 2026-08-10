# Bir Festival 2026 App — Functional Test Plan & Tester's Guide

**Audience:** Business Analyst / Functional Tester (no coding required)
**App:** Bir Festival 2026 mobile app (Android + iOS), Expo React Native
**Festival:** 21–23 November 2026, Bir–Billing
**Document date:** 2026-08-10 · **Build under test:** Evaluation build (self-contained, sample data)

---

## 1. Purpose & how to use this document

You are testing the **festival app** the way a real festival visitor, volunteer, partner
and organiser would use it. This document tells you:

- how to get the app on a phone (Section 4),
- how to sign in and reach every area (Sections 5–7),
- **what to click and what should happen** — the numbered test cases in Section 9,
- what is *deliberately not working yet* so you don't raise it as a bug (Section 11),
- how to report anything that fails (Section 12).

**How to run a test case:** read the *Pre-conditions*, do the *Steps* in order, compare what
you see to *Expected result*, then mark **Pass / Fail** and add a note. Copy the tracking
table in Section 12 into a spreadsheet if you prefer.

> **Golden rule:** if the *Expected result* does not happen, it's a finding — record it,
> even if you think you "did it wrong". Confusing UX is a valid finding.

---

## 2. What the app does (one-minute overview)

One app serves six kinds of people at the festival. Everyone signs in the same way; the
menu then shows the areas that person is allowed to use.

| Who | What they do in the app |
|---|---|
| **Visitor** (default) | Buy passes, see the cultural-night schedule, vote for the audience award, browse & register for Highlights (competitions, yoga, paragliding…), carry a QR pass that works offline, raise an SOS, check the paragliding "fly status". |
| **Volunteer** | See their shift roster, self check-in/out, **scan visitor passes at the gate** (works offline), report an incident. |
| **Partner — food stall** | See their stall allocation, fee status, daily footfall, food-street rules. |
| **Partner — hotel/hospitality** | See allocated guests and check them in. |
| **Admin — Hospitality** | Manage participant lodging: rooms, auto-allocate to rooms, issue participant badges. |
| **Organiser / Safety Officer** | Live operations snapshot; the Safety Officer **declares the fly-status** (Flying / Hold / Closed) that everyone else sees. |

The app is **offline-first**: passes, scanning, the schedule and attendance all work with the
phone in airplane mode, then sync when the network returns.

The app is **bilingual**: every screen can switch between **English and हिन्दी (Hindi)**.

---

## 3. Test environments — read this first

There are two ways the app can run. **For functional testing, use the Evaluation build.**

### 3A. Evaluation build ✅ (use this)
Self-contained. No backend, no SIM, no real money.
- Sign in with **any 10-digit number** and OTP **`123456`**.
- **All six roles are active at once**, so one login lets you test every area.
- Sample data is pre-loaded: schedule, competitions, rooms, shifts, stall, hotel, passes.
- Payments are **disabled by design** (you can reach the pay screen but not be charged).
- A **"Demo / Evaluation build"** banner is shown on the home screen.

This is what should be handed to a business analyst.

### 3B. Live-backend build ⚙️ (for later integration testing, not this pass)
Points at the real AWS backend. Requires: real phone numbers that receive an SMS OTP,
an administrator to assign each test user a role, and a live payment gateway. Several
server behaviours are still being wired (see Section 11), so **use 3A for the functional
pass** and schedule 3B for a later integration round.

> ⚠️ **Important — build freshness.** The APK currently on the download page was built
> **2026-08-06** and predates three feature drops (Highlights hub, Lodging & badges,
> Volunteer/Partner/Ops). **Ask the delivery team for a freshly-built Evaluation APK dated
> on/after 2026-08-10** before you begin, or the Highlights / Lodging / Volunteer / Partner /
> Ops sections below will not be present. When in doubt, check the "Published" date on the
> download page and the version string on the app's **More** screen.

---

## 4. Getting the app onto a phone

### Android (primary — recommended for testing)
1. On the test phone, open the **download page** link the delivery team gives you
   (a CloudFront/S3 URL showing the festival poster and a QR code).
2. Either tap **Download APK** on that page, or scan the **Android QR** with the camera.
3. Android will warn about "installing from unknown sources" — allow it for your browser
   (Settings prompt appears automatically), then open the downloaded `.apk` and tap **Install**.
4. Open **Bir Festival 2026**. You should land on the sign-in screen.

*Tip:* to test **offline** behaviour, install first while online, sign in once (so sample
data loads), then turn on **Airplane mode** for the offline test cases.

### iOS (limited)
Apple does not allow open APK-style installs. iOS testing needs **TestFlight** (the delivery
team adds your Apple ID as a tester and sends an invite) or a registered ad-hoc device. If you
only have an iPhone and no TestFlight invite yet, request one — otherwise test on Android.

---

## 5. Signing in (Evaluation build)

1. On the sign-in screen, enter **any 10-digit mobile number** (e.g. `9876543210`).
2. Tap **Send OTP / Continue**.
3. The next screen asks for a code and shows a demo hint. Enter **`123456`**.
4. You arrive on the **Home** screen with a **"Demo / Evaluation build"** banner.

That's it — you're now signed in with **all roles**, so every area in Section 6 is reachable.

*To sign out and start fresh:* **More → Sign Out**. Signing in again with `123456` reuses the
same sample data.

---

## 6. Where everything is (role → menu map)

From **Home**, the bottom tabs are: **Home · Schedule · My Pass · Explore · More**.
Everything else is reached from **Home** or the **More** menu:

| Area to test | How to reach it |
|---|---|
| Home / fly-status / SOS | **Home** tab |
| Cultural-night schedule + voting | **Schedule** tab |
| My passes (wallet, QR) | **My Pass** tab |
| Buy a ticket | Home pass card → **Get Pass**, or **My Pass → Book Ticket** |
| Highlights hub (competitions, yoga, adventure…) | Home → **Highlights** button |
| My Registrations | **More → My Registrations**, or Highlights footer |
| Volunteer: Roster / Scanner / Incident | **More → Roster** (then Scanner/Incident links) |
| Admin — Lodging (rooms, allocate, badges) | **More → Lodging** |
| Organiser/Safety — Ops & fly-status | **More → Ops** |
| Partner — Stalls | **More → Stalls** |
| Partner — Hospitality | **More → Hospitality** |
| Settings / quiet hours | **More → Settings** |
| Language (EN/हिन्दी) | Home top-right pill, or **More → Change Language** |

> In the Evaluation build all rows are visible because you hold all roles. In the real app,
> a person only sees the rows for their role — that role-gating is tested separately in the
> live-backend round (3B).

---

## 7. Switching language (test in both)

Tap the **EN / हिं** pill on the Home screen (top-right), or **More → Change Language**. The
entire app should immediately re-render in the other language — headings, buttons, labels,
and sample content (event names, rules) all have English + Hindi. Please run a few scenarios
in **each** language and note any text that stays English when Hindi is selected, overflows,
or is clipped.

---

## 8. Conventions used in the test cases

- **Pre-conditions** — what must be true before you start (e.g. "signed in", "airplane mode on").
- **Steps** — do these in order.
- **Expected result** — what a correct app shows.
- **Result** — you fill in: **Pass**, **Fail**, or **Blocked** (couldn't run it).
- Severity when logging a Fail: **Critical** (can't proceed / data loss / safety) ·
  **Major** (feature broken, workaround exists) · **Minor** (cosmetic, copy, layout).

---

## 9. Test scenarios

### 9.1 Onboarding & sign-in

| ID | Steps | Expected result |
|---|---|---|
| **LOGIN-01** | Launch app first time. | Sign-in screen with phone field and a language option. No crash. |
| **LOGIN-02** | Enter `9876543210`, tap Continue, enter OTP `123456`. | Lands on Home with a "Demo / Evaluation build" banner. |
| **LOGIN-03** | Enter a clearly invalid phone (e.g. `12`). | App refuses / shows a friendly validation message; does not proceed. |
| **LOGIN-04** | On the OTP screen enter a wrong code (e.g. `000000`). | Sign-in is refused with a clear message; you can retry. |
| **LOGIN-05** | **More → Sign Out**, then relaunch the app. | App returns to the sign-in screen (session cleared). |
| **LOGIN-06** | Sign in again with `123456`. | Same sample data as before (passes, schedule still present). |

### 9.2 Home, fly-status & SOS

| ID | Steps | Expected result |
|---|---|---|
| **HOME-01** | Land on Home. | See festival hero, a fly-status chip, a pass card, a Highlights button, and the demo banner. |
| **HOME-02** | Read the fly-status chip. | Shows **Flying** (green) in sample data, with a short reason. |
| **HOME-03** | Tap the **SOS** button **once**. | It asks you to **confirm** (a second tap) — it must NOT fire on a single tap. |
| **HOME-04** | Tap **SOS** again to confirm. | Shows a "help sent / SOS raised" confirmation. (In demo it queues locally; no real dispatch.) |
| **HOME-05** | Tap the pass card. | Opens your QR pass (if you hold one) or routes to the buy screen. |
| **HOME-06** | Switch language on Home. | All Home text switches EN ↔ हिन्दी including the fly-status reason. |

### 9.3 Buy a ticket (P3.1)

> Payments are **disabled** in the Evaluation build. You are testing the *selection and
> confirmation journey and the wallet*, not an actual charge.

| ID | Steps | Expected result |
|---|---|---|
| **TKT-01** | Home pass card → **Get Pass** (or My Pass → Book Ticket). | Ticket tiers list appears: **Day pass ₹499** and **3-Day pass ₹1199**. |
| **TKT-02** | Select a tier. | Selection highlights; a **Pay** action is shown with the correct amount. |
| **TKT-03** | Attempt to pay. | In the Evaluation build the pay step is **disabled/blocked** (by design). Note the message shown. |
| **TKT-04** | Go to **My Pass**. | Any sample passes are listed, each with a QR and an "works offline" indication. |
| **TKT-05** | Open a pass, then enable **Airplane mode**, reopen the pass. | The QR pass still displays fully offline. |

### 9.4 Cultural nights: schedule, reminders & voting (P3.2)

| ID | Steps | Expected result |
|---|---|---|
| **CN-01** | Open **Schedule**. | Day tabs for **21 / 22 / 23 Nov**; each day lists events with venue. |
| **CN-02** | Select **21 Nov**. | See e.g. **Folk music of Kangra** and other evening events. |
| **CN-03** | Tap **Remind** on an event. | A reminder toggles on (may ask notification permission the first time). |
| **CN-04** | Find a votable event (e.g. the award/audience-favourite) and tap **Vote**. | Vote is accepted once; the control reflects "voted" and prevents a second vote. |
| **CN-05** | Turn on **Airplane mode**, cast a vote/reminder, turn network back on. | Action is accepted offline and syncs later (no error, no data loss). |
| **CN-06** | Open the venue map/pins. | Venues (Chogan Ground, landing/take-off) are shown. |

### 9.5 Highlights hub & My Registrations (CO-002)

| ID | Steps | Expected result |
|---|---|---|
| **HL-01** | Home → **Highlights**. | Category hub: **Competitions, Cultural Nights, Yoga, Pottery, Adventure, Sightseeing**. |
| **HL-02** | Open **Competitions**. | Items incl. **Himalayan Prince 2026** and **Himalayan Queen 2026**, each with a capacity/availability chip. |
| **HL-03** | Open an item. | Details with **rules in English + Hindi**, eligibility, fee, and a registration form. |
| **HL-04** | Fill the form and **Register** (free item). | Registration is created; you're taken to **My Registrations** and it appears with a status chip. |
| **HL-05** | Open **Adventure → Paragliding**. | Multiple **time slots** are shown; a full slot is marked waitlist/closed, others open. |
| **HL-06** | In **My Registrations**, tap **Add to calendar**. | The device calendar add-sheet opens for that activity. |
| **HL-07** | In **My Registrations**, **Cancel** a registration. | Status changes to cancelled; it no longer counts as active. |
| **HL-08** | Switch language inside Highlights. | Category names, rules and item copy render in Hindi. |

### 9.6 Passes & offline QR (cross-cutting)

| ID | Steps | Expected result |
|---|---|---|
| **PASS-01** | **My Pass** tab. | Wallet lists your passes/badges by type. |
| **PASS-02** | Open a QR pass; note screen brightens. | QR is large and scannable; screen brightness boosts for scanning. |
| **PASS-03** | With **Airplane mode on**, open each pass. | All render offline. |

### 9.7 Volunteer: roster, attendance, scanner, incident (CO-004)

| ID | Steps | Expected result |
|---|---|---|
| **VOL-01** | **More → Roster**. | Your team name, ID-verification status, and a list of **shifts** across 21–23 Nov. |
| **VOL-02** | On a shift tap **Check In**, then **Check Out**. | Check-in records first; check-out updates the same shift. Works offline; a "pending sync" hint may show. |
| **VOL-03** | Open the **Scanner**. | Camera opens (grant permission once). A **Kiosk mode** toggle keeps the screen awake. |
| **VOL-04** | Point the scanner at one of your own QR passes (open it on a second phone, or a printout). | A verdict appears in under ~1 second: **green = valid**, **red = invalid**, with haptic feedback. |
| **VOL-05** | Turn on **Airplane mode** and scan again. | Scanning still returns a verdict offline; a "pending sync" counter increases. |
| **VOL-06** | **Roster → Report Incident**. Choose a category, add a note, optionally a photo, submit. | Incident is accepted and queued; returns to roster with a confirmation. |

### 9.8 Organiser / Safety Officer: ops & fly-status (CO-004)

| ID | Steps | Expected result |
|---|---|---|
| **OPS-01** | **More → Ops**. | Live snapshot: current fly-status, count of unsynced scans, queued writes, lodging version. |
| **OPS-02** | In the **Declare fly-status** section, type a reason in **English and Hindi**, tap **Hold**. | Confirmation "declared as Hold"; the declaration queues/sends. |
| **OPS-03** | Return to **Home**. | The fly-status chip now reflects **Hold**, and an **auto-refund** notice appears. |
| **OPS-04** | Back in Ops, set it to **Flying** again. | Home chip returns to Flying; refund notice disappears. |

### 9.9 Admin — Hospitality: lodging & badges (CO-003)

| ID | Steps | Expected result |
|---|---|---|
| **LOD-01** | **More → Lodging**. | Room inventory with status filter (all/active/held/retired) and a hotel search. |
| **LOD-02** | Tap **Add Room**, fill hotel, room label, capacity, sharing type, save. | New room appears in the inventory. |
| **LOD-03** | Tap **Allocate**. | The participant **pool** loads (e.g. Anita Thakur, Rohan Katoch) with an **Auto-suggest** option. |
| **LOD-04** | Tap **Auto-suggest**, then try to move someone into a room that breaks a rule (over capacity, or mixed-gender share). | The move is **blocked** with a clear reason **in English + Hindi**. |
| **LOD-05** | Make a valid placement and **Commit**. | Allocation is committed (syncs via outbox). |
| **LOD-06** | Open a participant **badge** (from My Registrations or the badge screen). | Badge shows competition name (EN+HI), **initials avatar and QR — no photo, and no gender shown anywhere**. |
| **LOD-07** | Open **Occupancy**. | Rooms by hotel with occupancy and check-in status. |

> **Privacy check (important):** confirm **gender never appears** on badges, occupancy, or any
> hotel-facing roster — it should only be visible on the *Allocate* screen. Flag any leak as **Critical**.

### 9.10 Partner: stalls & hospitality (P5.2 / P5.3)

| ID | Steps | Expected result |
|---|---|---|
| **PTR-01** | **More → Stalls**. | Stall console: name, category, application stage, allocation label, **fee & paid/unpaid**, daily footfall, and **food-street rules** (plastic ban, deposit-return, etc.) in EN+HI. |
| **PTR-02** | **More → Hospitality**. | Hotel console: tier, an occupancy summary, and guest rows each with a **Check In** button. |
| **PTR-03** | Tap **Check In** on a guest. | That guest shows as checked-in; the occupancy count updates. |

### 9.11 Settings & quiet hours (P3.4)

| ID | Steps | Expected result |
|---|---|---|
| **SET-01** | **More → Settings**. | A **Quiet hours** toggle (off by default). |
| **SET-02** | Turn it on, set start & end hours, save. | Preference saves and persists after leaving and re-opening Settings. |

### 9.12 Language parity (i18n) — run across the app

| ID | Steps | Expected result |
|---|---|---|
| **I18N-01** | Set language to **हिन्दी** and walk Home, Schedule, Highlights, My Registrations, Roster, Ops, Lodging. | No screen shows leftover English labels; no text is clipped or overflowing. |
| **I18N-02** | Switch back to **English** mid-flow. | App re-renders immediately; you stay on the same screen. |

### 9.13 Offline resilience — the headline promise

| ID | Steps | Expected result |
|---|---|---|
| **OFF-01** | Sign in online once (loads sample data), then enable **Airplane mode**. | App keeps working. |
| **OFF-02** | Offline: open a QR pass, view the schedule, scan a pass, check in to a shift, cast a vote. | All succeed offline; items that need the server show a "pending sync" state. |
| **OFF-03** | Turn network back on and wait a moment. | Pending items sync automatically; "pending" counters drop toward zero; nothing is lost or duplicated. |

---

## 10. Test data reference (what's pre-loaded)

**Ticket tiers:** Day pass **₹499**, 3-Day pass **₹1199**.

**Cultural-night schedule:** 21 Nov — *Folk music of Kangra* and evening events · 22 Nov —
live band / comedy / heritage · 23 Nov — guest appearance and the **Award ceremony** (votable).

**Fly-status:** starts as **Flying** ("clear skies over Billing").

**Highlights (sample catalog):** Competitions (**Himalayan Prince 2026**, **Himalayan Queen
2026**, chef contests), Cultural Nights, Yoga (sunrise, meditation), Pottery, **Adventure**
(paragliding with multiple slots, trekking, etc.), Sightseeing.

**Lodging pool (sample participants):** **Anita Thakur** (Himalayan Queen), **Rohan Katoch**
(Himalayan Prince), plus sample rooms (Deodar/Cedar/Pine) in active/held states.

**Volunteer roster (sample):** a volunteer with **4 shifts** across the festival, team
"Gate & Access", ID verified.

**Partner (sample):** a food stall ("Kangra Kitchen", allocation F-12, fee unpaid) and a
homestay ("Deodar Homestay") with guests to check in.

**Sample passes:** a ticket pass and a seat-entry pass are minted on first sign-in so the
wallet, QR display and scanner can all be exercised.

---

## 11. Known limitations — do **not** raise these as bugs (this pass)

These are expected in the Evaluation build / current backend state:

1. **Payments are disabled.** You can reach the pay step but cannot complete a charge.
   Testing stops at "pay is blocked / message shown".
2. **No real SMS OTP.** The only working code is the demo code **`123456`** (any phone number).
3. **All roles are visible at once.** Role-by-role gating (a volunteer *not* seeing Lodging,
   etc.) is validated later on the live-backend build, not here.
4. **Sample data only.** Names, rooms, stalls, shifts and competitions are illustrative; they
   won't match real festival entrants.
5. **AI "Explore/Assistant" is a placeholder.** It won't answer questions yet.
6. **Some server actions are simulated locally** (they queue and confirm on the device rather
   than round-tripping to AWS). This is intentional for a self-contained evaluation.
7. **iOS open-install isn't available** — needs TestFlight.

If something *outside* this list misbehaves, it's a finding.

---

## 12. Reporting findings

**For each Fail, capture:**

- **Test ID** (e.g. `HL-04`) and screen name
- **Device & OS** (e.g. "Samsung A14, Android 14"), and **app version** (from **More**)
- **Language** you were in (EN/HI)
- **Online or Airplane mode**
- **Steps to reproduce** (short, numbered)
- **Expected vs Actual**
- **Severity** (Critical / Major / Minor)
- **Screenshot or screen-recording** (please attach — invaluable)

**Tracking sheet columns (copy to a spreadsheet):**

| Test ID | Area | Device/OS | Lang | Net | Result (Pass/Fail/Blocked) | Severity | Notes / link to screenshot |
|---|---|---|---|---|---|---|---|

---

## 13. Suggested test rounds & exit criteria

**Round 1 — Visitor journey:** LOGIN, HOME, TKT, CN, HL, PASS, I18N, OFF.
**Round 2 — Operations:** VOL, OPS, LOD, PTR, SET.
**Round 3 — Language & offline sweep:** repeat a subset of Round 1 & 2 in Hindi and in
Airplane mode.

**Exit criteria for this functional pass:**
- All **Critical** and **Major** findings logged with reproduction steps.
- Every test ID has a **Pass / Fail / Blocked** result in the tracking sheet.
- The privacy check (LOD-06/07: no gender or photo on badges/rosters) is explicitly confirmed.
- Offline cases (OFF-01…03) verified on at least one Android device.

---

*Questions on any test case, or need a fresh Evaluation APK / TestFlight invite? Contact the
delivery team. This plan covers the CO-001 baseline plus the CO-002 (Highlights), CO-003
(Lodging & badges) and CO-004 (Volunteer / Partner / Ops) feature drops.*
