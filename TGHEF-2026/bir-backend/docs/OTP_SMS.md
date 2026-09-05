# OTP SMS — Fast2SMS (India)

Phone sign-in uses Cognito **custom-auth OTP**. The verification code is issued by
`terraform/lambda/custom-auth`; delivery is via **Fast2SMS** on its DLT-exempt
`otp` route (Fast2SMS supplies its own registered sender, so **no DLT
registration is required**).

## States

| `sms_enabled` | Fast2SMS key in SSM | Behaviour |
|---|---|---|
| `false` (default) | anything | **No SMS.** Every number signs in with the fixed `DEMO_OTP` (`000000`). This is the demo/testing state. |
| `true` | placeholder / unset | Random code generated but send fails → **safe fallback to `000000`** (sign-in never bricks). Logged to CloudWatch. |
| `true` | real key | Real 6-digit code **texted via Fast2SMS**. `DEMO_NUMBERS` still get `000000` (store review + test users). |

The code path lives in `CreateAuthChallenge` → `sendOtpSms()`; the key is read
from SSM at runtime and cached **only once a real value is present**, so setting
the key later takes effect **without a redeploy**.

## Go live (operator)

The API key never lives in the repo, contract, or client — set it out-of-band:

```bash
# 1) Put the Fast2SMS API key in SSM (SecureString)
aws ssm put-parameter --profile rhoai-demo --region us-east-1 \
  --name /bir-2026/otp/fast2sms-key --type SecureString --overwrite \
  --value '<FAST2SMS_API_KEY>'

# 2) Turn SMS on (Terraform var → Lambda env). DEMO_NUMBERS keep the fixed code.
cd bir-backend/terraform
terraform apply -var 'sms_enabled=true'
```

To keep a tester on the fixed code while live, add their number to
`demo_numbers` (E.164, e.g. `+9198…`). Default demo number: `+911100000007`.

## Notes

- Fast2SMS `otp` route sends its standard template with your code substituted.
- `numbers` must be a bare 10-digit Indian number; the Lambda strips the `+91`.
- Rolling the key back to a placeholder (or an invalid key) degrades gracefully
  to `000000` rather than blocking sign-in — watch CloudWatch for
  `OTP SMS send failed` if real texts stop arriving.
- Non-India delivery is out of scope for the `otp` route; revisit if needed.
