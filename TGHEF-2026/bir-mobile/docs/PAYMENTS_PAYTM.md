# Payments — Paytm gateway (B5)

The festival app takes payments through **Paytm All-in-One** (UPI, cards,
netbanking, wallet — all modes come from Paytm's checkout, not the app). The
architecture is the standard webhook-confirmed flow (ARCHITECTURE §5): **payment
success is asserted only by the backend**, never by the app.

## Flow

1. `createOrder` (REST `POST /pay/order`, Cognito-authorized) prices the item
   **server-side**, writes a `PENDING` order, calls Paytm **Initiate
   Transaction** (signed with the merchant key) → returns a `txnToken`.
2. The app opens the **Paytm All-in-One SDK** with that `txnToken`.
3. Paytm calls `POST /pay/webhook` → the webhook **verifies the checksum**,
   **re-checks with Paytm's Order Status API** (never trusts the callback),
   mints the pass token(s) via `pass-signer`, and invokes the server-only
   `confirmOrder` mutation → **`onOrderConfirmed`** delivers the passes to the
   waiting app. If the app was killed, `getOrder` recovers on next launch.

## The merchant key stays server-side — provision it yourself

The Paytm **Merchant Key** (checksum secret) and **MID** live **only** in SSM,
read by the backend Lambdas. They are never in the repo, the contract, or the
app. After you have your Paytm merchant credentials, set them (staging shown):

```bash
AWS_PROFILE=rhoai-demo AWS_REGION=us-east-1

aws ssm put-parameter --name /bir-2026/payments/paytm-mid \
  --type String --overwrite --value '<YOUR_PAYTM_MID>'

aws ssm put-parameter --name /bir-2026/payments/paytm-key \
  --type SecureString --overwrite --value '<YOUR_PAYTM_MERCHANT_KEY>'
```

Until these are set, `createOrder` returns `503 paytm credentials not
provisioned` (verified). No redeploy is needed — the Lambdas read SSM at
runtime.

- **Environment:** defaults to Paytm **staging** (`securegw-stage`). Flip to
  production by setting the Terraform `paytm_env = "prod"` variable (and the app
  contract `payments.paytm.environment = "prod"`), then `deploy.sh`.
- **Callback URL** (register with Paytm if required): the `POST /pay/webhook`
  route on the payments API — `terraform output payments_rest_base` + `/pay/webhook`.
- **Return scheme:** the SDK returns to the app via the `bir://` URL scheme.

## What's verified vs. pending

- **Verified against the live stack:** createOrder auth + server-side pricing +
  the 503 creds-gate; getOrder owner-scoping; confirmOrder fan-out (IAM only —
  a client is rejected `Unauthorized`); the Paytm checksum round-trip.
- **Pending your Paytm account:** the real Initiate Transaction / Order Status
  calls and an end-to-end paid transaction (a payment can only be exercised with
  your staging MID/key on a device).
