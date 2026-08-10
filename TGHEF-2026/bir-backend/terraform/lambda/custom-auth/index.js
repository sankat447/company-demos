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
      // TODO(prod): const code = String(Math.floor(100000 + Math.random()*900000));
      //   send via SNS to event.request.userAttributes.phone_number.
      const code = '000000';
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
