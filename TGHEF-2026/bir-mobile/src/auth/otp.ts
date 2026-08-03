/**
 * Cognito OTP phone auth (P1.1): custom auth flow, OTP delivered via SNS SMS
 * (contract auth.otpChannel = "sms"). Amplify manages refresh; tokens live in
 * secure storage (see src/config/amplify.ts).
 */
import { confirmSignIn, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';

export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  throw new Error('invalid-phone');
}

/** Step 1: start custom auth — backend sends the OTP SMS. */
export async function requestOtp(phone: string): Promise<void> {
  const username = normalizePhone(phone);
  // A stale session makes signIn throw UserAlreadyAuthenticatedException.
  try {
    await getCurrentUser();
    return; // already signed in
  } catch {
    // not signed in — proceed
  }
  const result = await signIn({
    username,
    options: { authFlowType: 'CUSTOM_WITHOUT_SRP' },
  });
  if (result.nextStep.signInStep !== 'CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE') {
    throw new Error(`unexpected sign-in step: ${result.nextStep.signInStep}`);
  }
}

/** Step 2: answer the challenge with the 6-digit code. */
export async function submitOtp(code: string): Promise<boolean> {
  const result = await confirmSignIn({ challengeResponse: code.trim() });
  return result.isSignedIn;
}

export async function signOutEverywhere(): Promise<void> {
  await signOut();
}
