/**
 * Cognito custom-auth OTP (phone-first). Three triggers in one handler:
 *   DefineAuthChallenge  → orchestrate the CUSTOM_CHALLENGE flow
 *   CreateAuthChallenge  → generate a 6-digit code, send via SNS SMS
 *   VerifyAuthChallenge  → compare the user's answer to the issued code
 * The demo build accepts a fixed code for store review (BACKEND_ASKS #5).
 */
interface CognitoTriggerEvent {
  triggerSource: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}

export async function handler(event: CognitoTriggerEvent): Promise<CognitoTriggerEvent> {
  switch (event.triggerSource) {
    case 'DefineAuthChallenge_Authentication': {
      const session = (event.request.session as unknown[]) ?? [];
      const r = event.response;
      if (session.length === 0) {
        r.challengeName = 'CUSTOM_CHALLENGE';
        r.issueTokens = false;
        r.failAuthentication = false;
      } else {
        const last = session[session.length - 1] as { challengeResult?: boolean };
        r.issueTokens = last.challengeResult === true;
        r.failAuthentication = last.challengeResult !== true;
      }
      break;
    }
    case 'CreateAuthChallenge_Authentication': {
      // TODO(backend): const code = randomInt(100000, 999999).toString();
      //   send via @aws-sdk/client-sns to the phone_number attribute,
      //   stash the code in privateChallengeParameters (never public).
      event.response.publicChallengeParameters = { deliveryMedium: 'SMS' };
      event.response.privateChallengeParameters = { code: '000000' }; // TODO
      event.response.challengeMetadata = 'OTP_CHALLENGE';
      break;
    }
    case 'VerifyAuthChallengeResponse_Authentication': {
      const expected = (event.request.privateChallengeParameters as { code?: string })?.code;
      const answer = event.request.challengeAnswer as string;
      event.response.answerCorrect = answer === expected;
      break;
    }
  }
  return event;
}
