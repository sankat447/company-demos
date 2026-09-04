# Bir Festival — Ops Console (`bir-admin`)

A dependency-free static web console for organisers to run the festival against
the **live** backend. No build step, no framework — just `index.html` + `app.js`
+ `styles.css` + `config.js`.

## What an organiser can do

**Monitor** (festival-wide analytics, from the organiser-guarded `/admin/*` API):

| Panel | Shows | Backend |
|---|---|---|
| **Overview** | KPI board: fly-status, registrations, ticket revenue, gate scans, stalls, lodging, volunteers, incidents — plus quick fly-set + assistant | `/admin/summary` |
| **Visitors & tickets** | Registrations by activity & status, ticket sales & revenue by tier | `/admin/visitors` |
| **Stalls** | Food-street roster: stage, allocation, fees paid/due, est. orders, footfall | `/admin/stalls` |
| **Lodging** | Rooms & beds by hotel, hospitality partners, complimentary rooms, check-ins, pool needing lodging | `/admin/lodging` |
| **Volunteers** | Roster, teams, shifts, ID-verification, attendance records | `/admin/volunteers` |
| **Incidents** | Field incident log by category/zone/time | `/admin/incidents` |

**Operate**:

| Panel | Capability | Backend |
|---|---|---|
| **Fly-status** | Declare flying / hold / closed with EN+HI reasons — fans out to devices, auto-queues refunds when closed (**safety-officer**) | `setFlyStatus` |
| **Knowledge & AI** | Add/edit/delete **FAQs live** (no deploy), test the RAG assistant, KB-bucket upload command | `/ai/faq`, `/ai/assistant` |
| **Passes** | Revoke a pass (fans out to offline scanners), view the revocation feed | `revokePass`, `revocationsDelta` |
| **Schedule & tiers** | Ticket tiers + schedule (read-only) | `ticketTiers`, `scheduleDelta` |

The `/admin/*` analytics API is a read-only Lambda that aggregates across the
single table (the partner consoles are scoped to each partner's own account; this
is the festival-wide view). It is guarded to the organiser roles.

Role gating mirrors the server: `safety-officer` for fly-status,
`organiser-lite`/`safety-officer` for FAQs & revocations, `admin-hospitality`
for lodging. The server re-checks every privileged call — the UI only hides what
you can't do.

## Sign-in & the admin hierarchy

Admins sign in with a **username and password** (no OTP). Auth is self-contained
in the admin Lambda: scrypt-hashed passwords, an HS256 JWT signed with a secret
in SSM. There are **4 tiers**, and you can create/manage admins **strictly below
your own tier** (the Superadmin also manages peers; the last active Superadmin
can't be removed):

| Tier | Role | Manages | Powers |
|---|---|---|---|
| **1** | Superadmin (master) | everyone, incl. other Superadmins | everything |
| **2** | Admin | Managers + Coordinators | fly-status, revoke, FAQ/KB, monitoring, admin mgmt |
| **3** | Manager | Coordinators | FAQ/KB, monitoring, admin mgmt |
| **4** | Coordinator | — | monitoring only |

Manage admins from the **Admins** panel (visible to tiers 1–3): create, reset
password, enable/disable, delete. The UI hides what your tier can't do and the
server re-checks every call.

### First-time setup — create the master admin

The console ships with **no default admin**. On first use, click **"First-time
setup — create master admin"** on the login screen and set your own master
username + password (this works only once, while no admin exists). Or from a
terminal:

```bash
REST=$(cd ../bir-backend/terraform && terraform output -raw payments_rest_base)
curl -X POST "$REST/admin/auth/bootstrap" -H 'Content-Type: application/json' \
  -d '{"username":"master","name":"Master Admin","password":"YOUR-STRONG-PASSWORD"}'
```

After that, sign in and create the rest of your admins from the Admins panel.
Passwords are never stored in plaintext and never leave the backend.

## Run it locally

```bash
cd TGHEF-2026/bir-admin
python3 -m http.server 8791
# open http://localhost:8791
```

`config.js` holds the live stack's **public** identifiers (user-pool id, app
client id, GraphQL + REST endpoints — none are secrets). Regenerate them from
`terraform output` in `bir-backend` if the stack is redeployed:

```bash
./gen-config.sh   # writes config.js from terraform outputs
```

## Deploy (optional)

It's a static site — host it anywhere private to your team. To put it on the
existing app-dist bucket/CloudFront under `/admin/`:

```bash
./deploy.sh   # syncs to s3://<app-dist bucket>/admin/ and invalidates CloudFront
```

Access still requires an organiser Cognito login, so the page itself is safe to
host; nothing sensitive lives in the static files.

## Notes

- The HTTP API has permissive CORS (Bearer tokens in the `Authorization` header,
  no cookies), so the browser can call `/ai/*` directly.
- Uploading knowledge-base **documents** (rules/instructions) needs S3 write
  credentials, so it's a CLI step (the console shows the exact `aws s3 cp`
  command); everything else is in the browser.
