# DPDP — consent, retention, deletion

What personal data the festival app holds, and how consent/retention/deletion are
handled for a first live version.

## PII inventory

| Data | Where | Purpose |
|---|---|---|
| Phone number | Cognito username | Sign-in (OTP) |
| Name, DOB | `PROFILE#<sub>` | Master-ticket age-band (only the band goes in the QR) |
| Registrations | `REG` rows (sub) | Activity entitlement |
| Orders | `ORDER` rows (sub) | Payments |
| Device tokens | `DEVICE#<sub>` | Push (when enabled) |
| Wristband guardian contact | `WRISTBAND` | Child-safety lookup |

Age-band is derived server-side at mint time — the DOB never leaves the backend
and only the band (`child`/`minor`/`adult`) is in the pass. Good minimisation.

## Consent (shipped, M6)

`setProfile` now stores a **defensible consent artifact**, not a bare boolean:
`consentDpdp` + `consentVersion` (`2026-v1`) + `consentAt` (epoch), stamped only
when consent is actually given. Re-consent after a notice change = bump the
version constant in `set-profile.req.vtl`. The consent notice text the version
refers to should be kept under version control alongside it.

## Retention

This is a single-event product that ends **30 Nov 2026** with close-out duties.
Retention policy for v1:

- **Passes, certificates, public report:** kept viewable through close-out.
- **PROFILE / REG / ORDER / DEVICE / WRISTBAND:** delete after close-out + the
  statutory settlement/dispute window (align with the payment provider's chargeback
  window). Enable DynamoDB TTL on these partitions at close-out, or run a one-off
  purge.
- Audit + refund records: keep for the financial-record period, then purge.

## Deletion / data-subject requests (follow-up)

Self-service "delete my data" is **not yet built**. For v1, handle DSR requests
operationally: on request, delete the person's `PROFILE#<sub>` / `REG` / `ORDER` /
`DEVICE#<sub>` rows and their Cognito user (the admin now has Cognito user delete).
The clean follow-up is a Cognito-authed `DELETE /me/data` endpoint that a person
triggers from Settings and that removes their own rows + disables their login —
scoped to the caller's own `sub`, no admin needed.

## Not collected

No third-party analytics SDKs; analytics events go only to the backend. Location
is used only for a consented SOS report — see the SOS flow.
