/**
 * Cognito custom-auth OTP (phone-first). One handler, three triggers.
 * DEMO note: emits a fixed code (000000) so store-review + demo work without SMS
 * spend. For production, set the Fast2SMS key in SSM and flip SMS_ENABLED=true —
 * real 6-digit codes are then texted via Fast2SMS's DLT-exempt `otp` route.
 * DEMO_NUMBERS always get the fixed code, even when SMS is on.
 */
'use strict';
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

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
        code = String(Math.floor(100000 + Math.random() * 900000));
        try {
          await sendOtpSms(phone, code);
        } catch (e) {
          // Never brick sign-in on an SMS error in non-prod — fall back to the
          // demo code (also covers a not-yet-configured Fast2SMS key).
          console.error('OTP SMS send failed, using demo code:', e.message);
          code = demoOtp;
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
    default:
      break;
  }
  return event;
};
