# bir-backend — Bir Festival 2026 AWS backend (CDK scaffold)

The backend the mobile app (`../bir-mobile`) consumes. Its whole job is to
**produce exactly the stack contract** the app validates against
`schemas/stack-contract.schema.json`, and to own the server-side business
logic the app deliberately never does (pass signing, payment confirmation,
constraint re-validation, push fan-out).

> **Status: scaffold.** Infrastructure, the GraphQL SDL, and Lambda handler
> signatures are in place. Resolver mapping templates and the handler bodies
> marked `TODO(backend)` must be completed before a production deploy. This
> exists so the team has a running start on BACKEND_ASKS #1–#37.

## What's provisioned (`lib/bir-backend-stack.ts`)

| Contract key(s) | Resource |
|---|---|
| `auth.*` | Cognito User Pool (phone OTP via custom-auth triggers) + 6 role groups + Identity Pool |
| `api.graphqlEndpoint` / `graphqlRealtime` | AppSync GraphQL API (`schema/schema.graphql`) over DynamoDB + Lambda data sources |
| system of record | DynamoDB single-table (`pk`/`sk` + `gsi1`), PAY_PER_REQUEST, streams on |
| `storage.*` | media + app-dist S3 buckets, each behind CloudFront |
| `passes.*` | ES256 pass-signer Lambda; JWKS published to the media CDN |
| payments | Razorpay webhook Lambda (HMAC-verified → order CONFIRMED → passTokens) |
| `realtime.alertTopicArnParam` | SSM parameter |

Every `CfnOutput` maps one-to-one to a contract key.

## The security posture the app depends on

- **Payments are confirmed only here.** The app treats the Razorpay client
  callback as advisory; only the webhook (`lambda/payment-webhook`) sets an
  order CONFIRMED and mints pass tokens.
- **Passes/badges are signed only here** (ES256, private key in SSM/KMS). The
  app verifies OFFLINE with the public JWKS and never holds a signing key.
- **Privileged mutations re-check the Cognito group in the resolver** —
  `setFlyStatus` (safety-officer), `commitAllocation`/`issueBadge`
  (admin-hospitality). The client role gate is UX only; enforcement is here.
- **CO-003 §3 constraints are re-validated server-side** on `commitAllocation`
  (gender sharing, couple exclusivity, per-night capacity) — never trust the
  client's proposal.
- **Everything is audit-logged** (who/when/prior-state; `actorNote` on manual
  overrides).

## Deploy

```bash
npm install
npx cdk bootstrap            # first time per account/region
npm run deploy               # cdk deploy --outputs-file cdk-outputs.json
npm run emit-contract        # writes ../bir-mobile/config/stack-outputs.json
cd ../bir-mobile && npm run contract:check   # must pass
```

Then flip the app's `flags.mock*` off and the mocked screens (highlights,
lodging, volunteer, partner) run against real data.

## Remaining work (the `TODO(backend)` markers)

1. AppSync resolvers per operation in `schema/schema.graphql`.
2. `pass-signer`: SSM private-key retrieval + `issueBadge`/`revoke` bodies.
3. `payment-webhook`: parse the Razorpay payload, mark order, mint tokens.
4. `custom-auth`: real OTP generation + SNS SMS send.
5. REST API Gateway for `payments.orderPath` + the four `ai.*` paths
   (Bedrock behind Lambda) → adds `api.restBase` to the outputs.
6. Pinpoint app + platform endpoints for push → `push.*`.
7. Location Service geofence collection + shuttle tracker → `geo.*`.
