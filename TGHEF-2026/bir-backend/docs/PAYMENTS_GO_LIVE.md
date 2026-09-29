# Payments — go-live (Paytm staging → production)

Payments run through Paytm. Today the stack is on **staging** (`securegw-stage`),
so no real money moves. Flipping to production is an **operator action** (real
credentials + real money) — do NOT do it casually.

## What controls the environment

- Backend: `var.paytm_env` (`staging` | `production`) sets `PAYTM_ENV` on the
  `create-order` and `payment-webhook` Lambdas → chooses the Paytm host.
- Contract: the mobile app reads `payments.paytm.environment` from
  `config/stack-outputs.json`, which `scripts/emit-stack-outputs.sh` now fills
  from the `paytm_env` terraform output (no longer hardcoded).
- Credentials: `/${name}/payments/paytm-mid` (String) + `/${name}/payments/paytm-key`
  (SecureString) in SSM — the merchant key never lives in the repo or client.

## Go-live checklist (operator)

```bash
# 1) Put the PRODUCTION Paytm merchant credentials in SSM (values never printed here)
aws ssm put-parameter --profile rhoai-demo --region us-east-1 \
  --name /bir-2026/payments/paytm-mid --type String       --overwrite --value '<PROD_MID>'
aws ssm put-parameter --profile rhoai-demo --region us-east-1 \
  --name /bir-2026/payments/paytm-key --type SecureString --overwrite --value '<PROD_MERCHANT_KEY>'

# 2) Point the gateway at production
cd bir-backend/terraform
terraform apply -var 'paytm_env=production'

# 3) Regenerate the mobile contract so the app uses the production gateway,
#    then rebuild the app with the new contract
bash scripts/emit-stack-outputs.sh      # writes config/stack-outputs.json (paytm.environment=production)

# 4) Smoke-test ONE small real order end-to-end, then confirm the refund path
#    (Admin → Orders → request refund → process) before opening sales.
```

## Notes

- Prices are server-authoritative: tickets from `TIER`, activities from `ITEMCFG`
  — both editable live via the admin console (no redeploy). Never trust a client
  amount.
- Refunds are a **manual** process: the admin raises a refund request against an
  order and marks it processed with a Paytm reference (there is no automatic
  gateway refund). See the admin **Orders / Refunds** views.
- Keep `paytm_env=staging` for any demo/eval build — real cards must never hit a
  demo stack.
