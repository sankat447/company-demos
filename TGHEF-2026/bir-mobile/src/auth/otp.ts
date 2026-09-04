/**
 * Cognito OTP phone auth (P1.1): custom auth flow, OTP delivered via SNS SMS
 * (contract auth.otpChannel = "sms"). Amplify manages refresh; tokens live in
 * secure storage (see src/config/amplify.ts).
 */
import { confirmSignIn, getCurrentUser, signIn, signOut, signUp } from 'aws-amplify/auth';

export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  // 10-digit mobile, 12-digit with 91 country code, or 11-digit with the
  // domestic trunk 0 (e.g. 09812345678) — all map to the same E.164 number.
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  throw new Error('invalid-phone');
}

// A throwaway password that satisfies the pool policy (>=8, upper/lower/digit/
// symbol). It is never used to authenticate — every login goes through the OTP
// custom challenge — it exists only so SignUp can create the account record.
function throwawayPassword(): string {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const L = 'abcdefghijkmnpqrstuvwxyz';
  const D = '23456789';
  const S = '!@#$%^&*-_';
  const all = U + L + D + S;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let p = pick(U) + pick(L) + pick(D) + pick(S);
  for (let i = 0; i < 12; i++) p += pick(all);
  return p;
}

/**
 * Ensure the phone has a Cognito account before the OTP challenge. The pool has
 * prevent_user_existence_errors ON, so signIn returns a phantom challenge for an
 * unknown number and its OTP can never issue tokens — a first-time visitor would
 * be stuck on the code screen forever. SignUp is idempotent here: a new number is
 * created and auto-confirmed (PreSignUp trigger), an existing one throws
 * UsernameExistsException which we treat as success.
 */
async function ensureAccount(username: string): Promise<void> {
  try {
    await signUp({
      username,
      password: throwawayPassword(),
      options: { userAttributes: { phone_number: username } },
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'UsernameExistsException') return;
    throw e;
  }
}

/**
 * Step 1: start custom auth — backend sends the OTP SMS. Returns 'sms' when
 * the real flow started, 'demo-fallback' when Cognito is unreachable or
 * unconfigured (example stack outputs) — the OTP screen then accepts only
 * the demo code (see src/demo/demo.ts).
 */
/**
 * DEMO AUTH SWITCH. While no OTP delivery service is wired (Fast2SMS/DLT pending),
 * sign-in runs on the offline demo session: any number + the dummy code (DEMO_OTP,
 * currently 000000) opens a fully-seeded local session — no SMS, no Cognito token
 * round-trip, works every time for the live demo. Flip to false to switch on the
 * live Cognito custom-auth path below (self-signup + OTP challenge; the backend
 * PreSignUp trigger and server-authoritative OTP are already deployed). Keep the
 * two paths in sync: the OTP screen renders demo vs. SMS purely off this result.
 */
const DEMO_AUTH: boolean = true;

export async function requestOtp(phone: string): Promise<'sms' | 'demo-fallback'> {
  const username = normalizePhone(phone);
  if (DEMO_AUTH) return 'demo-fallback';
  // A stale session makes signIn throw UserAlreadyAuthenticatedException.
  try {
    await getCurrentUser();
    return 'sms'; // already signed in
  } catch {
    // not signed in — proceed
  }
  try {
    // Register the number first (idempotent) so signIn doesn't hand back a
    // phantom challenge for a first-time visitor — see ensureAccount.
    await ensureAccount(username);
    const result = await signIn({
      username,
      options: { authFlowType: 'CUSTOM_WITHOUT_SRP' },
    });
    if (result.nextStep.signInStep !== 'CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE') {
      throw new Error(`unexpected sign-in step: ${result.nextStep.signInStep}`);
    }
    return 'sms';
  } catch {
    return 'demo-fallback';
  }
}

/** Step 2: answer the challenge with the 6-digit code. */
export async function submitOtp(code: string): Promise<boolean> {
  const result = await confirmSignIn({ challengeResponse: code.trim() });
  return result.isSignedIn;
}

export async function signOutEverywhere(): Promise<void> {
  const { disableDemoSession } = await import('@/demo/demo');
  const { kvStore } = await import('@/offline/db');
  await disableDemoSession(kvStore).catch(() => {});
  await signOut();
}
