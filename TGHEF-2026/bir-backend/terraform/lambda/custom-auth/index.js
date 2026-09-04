/**
 * Cognito custom-auth OTP (phone-first). One handler, three triggers.
 * DEMO note: emits a fixed code (000000) so store-review + demo work without SMS
 * spend. For production, set the Fast2SMS key in SSM and flip SMS_ENABLED=true —
 * real 6-digit codes are then texted via Fast2SMS's DLT-exempt `otp` route.
 * DEMO_NUMBERS always get the fixed code, even when SMS is on.
 */
'use strict';
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

// DEMO: when DEMO_ALL_ROLES=true, a newly-confirmed user is added to EVERY role
// group so the demo build can show every surface (visitor + staff + partner +
// volunteer + organiser) from one login. Production leaves this unset — users
// then default to the visitor role and organisers are granted groups explicitly.
const ALL_ROLES = ['visitor', 'partner', 'volunteer', 'organiser-lite', 'admin-hospitality', 'safety-officer'];
const cognito = new CognitoIdentityProviderClient({});
async function grantAllRoles(userPoolId, username) {
  await Promise.all(
    ALL_ROLES.map((g) =>
      cognito
        .send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: g }))
        .catch((e) => console.error('grantAllRoles', g, e.message)),
    ),
  );
}

// Fast2SMS API key (SecureString in SSM). Cached only once a REAL value is read,
// so a placeholder→real rotation is picked up WITHOUT a redeploy.
let cachedKey = null;
async function fast2smsKey() {
  if (cachedKey) return cachedKey;
  const out = await new SSMClient({}).send(
    new GetParameterCommand({ Name: process.env.FAST2SMS_KEY_PARAM, WithDecryption: true }),
  );
  const v = (out.Parameter && out.Parameter.Value) || '';
  if (!v || v.startsWith('REPLACE')) throw new Error('fast2sms key not configured');
  cachedKey = v;
  return cachedKey;
}
// Fast2SMS wants a bare 10-digit Indian number (no +91).
function to10Digit(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}
async function sendOtpSms(phone, code) {
  const key = await fast2smsKey();
  const url =
    'https://www.fast2sms.com/dev/bulkV2?route=otp&flash=0' +
    `&authorization=${encodeURIComponent(key)}` +
    `&variables_values=${encodeURIComponent(code)}` +
    `&numbers=${encodeURIComponent(to10Digit(phone))}`;
  const res = await fetch(url, { method: 'GET' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.return !== true) {
    throw new Error(`fast2sms send failed: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return true;
}

exports.handler = async (event) => {
  switch (event.triggerSource) {
    case 'DefineAuthChallenge_Authentication': {
      const session = event.request.session || [];
      if (session.length === 0) {
        event.response.challengeName = 'CUSTOM_CHALLENGE';
        event.response.issueTokens = false;
        event.response.failAuthentication = false;
      } else {
        const last = session[session.length - 1];
        event.response.issueTokens = last.challengeResult === true;
        event.response.failAuthentication = last.challengeResult !== true;
      }
      break;
    }
    case 'CreateAuthChallenge_Authentication': {
      // Real random OTP over Fast2SMS, gated by SMS_ENABLED so the demo stack (and
      // store review) keep the fixed DEMO_OTP without SMS spend. DEMO_NUMBERS
      // always get the fixed code even when SMS is on (test + review).
      const demoOtp = process.env.DEMO_OTP || '000000';
      const smsEnabled = process.env.SMS_ENABLED === 'true';
      const phone = (event.request.userAttributes && event.request.userAttributes.phone_number) || '';
      const demoNumbers = (process.env.DEMO_NUMBERS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      let code;
      if (!smsEnabled || demoNumbers.includes(phone)) {
        code = demoOtp; // demo / store-review path — no SMS sent
      } else {
        // SMS is LIVE for this real number. Generate a random code and text it.
        // On failure we DO NOT fall back to the fixed demo code — that would make
        // every account trivially impersonable on any SMS outage/misconfig. We
        // keep the (undelivered) random code, so sign-in fails closed. The operator
        // must verify the SMS path works before enabling it (see docs/OTP_SMS.md).
        code = String(Math.floor(100000 + Math.random() * 900000));
        try {
          await sendOtpSms(phone, code);
        } catch (e) {
          console.error('OTP SMS send failed (fail-closed, no demo fallback):', e.message);
        }
      }
      event.response.publicChallengeParameters = { deliveryMedium: 'SMS' };
      event.response.privateChallengeParameters = { code };
      event.response.challengeMetadata = 'OTP_CHALLENGE';
      break;
    }
    case 'VerifyAuthChallengeResponse_Authentication': {
      const expected = (event.request.privateChallengeParameters || {}).code;
      event.response.answerCorrect = event.request.challengeAnswer === expected;
      break;
    }
    case 'PostConfirmation_ConfirmSignUp': {
      // Demo-only: give the fresh account every role so all surfaces are visible.
      if (process.env.DEMO_ALL_ROLES === 'true') {
        await grantAllRoles(event.userPoolId, event.userName);
      }
      break;
    }
    case 'PreSignUp_SignUp':
    case 'PreSignUp_ExternalProvider': {
      // Self-service onboarding for visitors: this is a phone-OTP pool with no
      // password login and no separate SMS confirmation step, so auto-confirm the
      // account and mark the phone verified on sign-up. Identity is still proven
      // on every login by the OTP custom challenge above — sign-up only creates
      // the record so a first-time number isn't a phantom (anti-enumeration) user
      // whose challenge can never issue tokens. Admin-created users keep their own
      // AdminCreateUser confirm path and are intentionally not matched here.
      event.response.autoConfirmUser = true;
      if (event.request.userAttributes && event.request.userAttributes.phone_number) {
        event.response.autoVerifyPhone = true;
      }
      break;
    }
    default:
      break;
  }
  return event;
};
