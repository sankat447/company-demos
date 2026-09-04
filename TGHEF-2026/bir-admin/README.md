# Bir Festival — Ops Console (`bir-admin`)

A dependency-free static web console for organisers to run the festival against
the **live** backend. No build step, no framework — just `index.html` + `app.js`
+ `styles.css` + `config.js`.

## What an organiser can do

| Panel | Capability | Backend |
|---|---|---|
| **Overview** | Live snapshot (fly-status, FAQ/revocation/schedule counts), quick fly-status set, quick assistant test, recent revocations | AppSync + `/ai/assistant` |
| **Fly-status** | Declare flying / hold / closed with EN+HI reasons — fans out to devices, auto-queues refunds when closed (**safety-officer**) | `setFlyStatus` |
| **Knowledge & AI** | Add/edit/delete **FAQs live** (no deploy), test the assistant, KB-bucket upload command | `/ai/faq`, `/ai/assistant` |
| **Passes** | Revoke a pass (fans out to offline scanners), view the revocation feed | `revokePass`, `revocationsDelta` |
| **Reference** | Ticket tiers + schedule (read-only) | `ticketTiers`, `scheduleDelta` |

Role gating mirrors the server: `safety-officer` for fly-status,
`organiser-lite`/`safety-officer` for FAQs & revocations, `admin-hospitality`
for lodging. The server re-checks every privileged call — the UI only hides what
you can't do.

## Sign-in

Cognito OTP (phone → one-time code). Test/demo numbers get the fixed code
`000000`; real numbers get an SMS once `sms_enabled=true` on the backend. Your
account needs one of the organiser roles above.

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
