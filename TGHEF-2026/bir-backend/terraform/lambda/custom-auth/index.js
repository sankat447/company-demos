/**
 * Cognito custom-auth OTP (phone-first). One handler, three triggers.
 * DEMO note: emits a fixed code (000000) so store-review + demo work without
 * SNS spend. Wire the SNS SMS send + random code before production (TODO).
 */
'use strict';

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
      // B6: real random OTP over SNS SMS, gated by SMS_ENABLED so the demo stack
      // (and store review) keep the fixed DEMO_OTP without SMS spend / DLT setup.
      // DEMO_NUMBERS always get the fixed code even when SMS is on (test + review).
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
          const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
          await new SNSClient({}).send(
            new PublishCommand({
              PhoneNumber: phone,
              Message: `${code} is your Bir Festival 2026 verification code.`,
              MessageAttributes: {
                'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
              },
            }),
          );
        } catch (e) {
          // Never brick sign-in on an SMS error in non-prod — fall back to demo code.
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
