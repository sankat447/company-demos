# bir-backend — Bir Festival 2026 AWS backend (Terraform)

The backend the mobile app (`../bir-mobile`) consumes. Provisioned with
**Terraform + `deploy.sh` / `destroy.sh`**, matching the company-demos
convention (NYCHHC/amboy). Its whole job: **produce exactly the stack contract
the app validates** and own the server-side logic the app deliberately never
does (pass signing, payment confirmation, constraint re-validation, push fan-out).

## One-command lifecycle

```bash
./deploy.sh            # provision everything + generate keys + seed test data
./scripts/cost-estimate.sh          # forward monthly estimate (this app only)
./scripts/cost-estimate.sh --actual # actual spend from Cost Explorer, tag-scoped
./destroy.sh           # tear down ONLY this app's objects, verified by tag sweep
```

`deploy.sh` owns the AWS SSO login (triggers `aws sso login` when the session is
missing), so you never pre-authenticate. Re-running is idempotent.

## Scoping — how deploy/destroy stay isolated from other projects

Two independent guarantees, so a teardown can **never** touch NYCHHC, amboy,
police-department, or any other company-demos stack:

1. **Ownership tags.** Every resource inherits `provider.default_tags`
   (`terraform/versions.tf`): `Project=bir-festival-2026`, `Application=bir-backend`,
   `ManagedBy=terraform`, `CostCenter=IIS-BIR-2026-DEMO`, `Owner`, `demo`,
   `Environment=demo`. This drives cost attribution and the destroy-time
   verification sweep.
2. **Isolated local state.** State is local to this stack (`terraform/backend.tf`)
   — `terraform destroy` can only ever see resources recorded in **this** file,
   making it structurally impossible to reach another project's resources.

`destroy.sh` finishes with a `resourcegroupstaggingapi` sweep that **refuses to
claim success** if anything tagged `Project=bir-festival-2026` still exists.

## What's provisioned (`terraform/`)

| Contract key(s) | Resource |
|---|---|
| `auth.*` | Cognito User Pool (phone OTP custom-auth Lambda) + 6 role groups + Identity Pool |
| `api.graphqlEndpoint` / `graphqlRealtime` | AppSync GraphQL API (`schema.graphql`) over DynamoDB |
| system of record | DynamoDB single-table (`pk`/`sk` + `gsi1`), PAY_PER_REQUEST, streams, PITR |
| `storage.*` | media + app-dist S3 buckets, each behind CloudFront (toggle `enable_cdn`) |
| `passes.*` | ES256 pass-signer Lambda; **private key generated at deploy into SSM SecureString**, JWKS published to the media CDN |
| payments | Razorpay webhook Lambda (HMAC-verified) via a Function URL |
| — | health Lambda (deploy smoke test) |

Every `terraform output` maps 1:1 to a contract key; `scripts/emit-stack-outputs.sh`
writes `../bir-mobile/config/stack-outputs.json` and validates it against the
app's own schema.

## Cost (forward estimate, festival load)

~**$21/month** at 50k MAU + 3M GraphQL ops + 2M Lambda invocations; **~$1–3/month
idle**. Everything is serverless/pay-per-use — **zero fixed compute cost**.
`./scripts/cost-estimate.sh --actual` returns the real month-to-date spend
filtered to `Project=bir-festival-2026` (this app only, never mixed with others).

## Security posture the app depends on

- **Payments confirmed only here** — the app treats the Razorpay client callback
  as advisory; only the webhook Lambda marks an order CONFIRMED + mints tokens.
- **Passes/badges signed only here** (ES256; private key never leaves SSM/KMS).
  The app verifies OFFLINE with the public JWKS.
- **Privileged mutations re-check the Cognito group in the resolver** —
  `setFlyStatus` (safety-officer), `commitAllocation`/`issueBadge`
  (admin-hospitality). The client role gate is UX only.
- **CO-003 §3 constraints re-validated server-side** on `commitAllocation`.
- Everything **audit-logged** (`actorNote` on manual overrides).

## Test data (`scripts/seed-test-data.sh`, run by deploy.sh)

Ticket tiers, a cultural-night schedule, a `flying` fly-status, and two confirmed
competition registrations (the lodging pool) — enough to exercise the app against
real data. Plus the published JWKS.

## Remaining work (`TODO` markers in the Lambdas / resolvers)

1. AppSync resolvers per operation in `schema.graphql` (privileged ones via
   Lambda data sources that re-check the group).
2. `pass-signer` `issueBadge`/`revoke` bodies; `payment-webhook` order handling;
   `custom-auth` real OTP + SNS send.
3. REST API Gateway for `payments.orderPath` + the four `ai.*` paths (Bedrock) →
   fills `api.restBase`.
4. Pinpoint app + platform endpoints → `push.*`; Location Service → `geo.*`.

The deployed stack is **live and verifiable** (endpoints resolve, Lambdas invoke,
data is seeded) before this business logic lands.
