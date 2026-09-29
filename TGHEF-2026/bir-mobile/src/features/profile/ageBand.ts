/**
 * Pure profile helpers (no Amplify) so the age-band logic stays unit-testable —
 * loadProfile/saveProfile live in profile.ts, which pulls the gql client.
 */
export type AgeBand = 'child' | 'minor' | 'adult' | '';

export interface Profile {
  displayName: string;
  dob: string; // YYYY-MM-DD
  consentDpdp: boolean;
}

/** child <13 · minor 13–17 · adult 18+. Empty for an unparseable/absurd date. */
export function ageBandFromDob(dob: string, now: Date = new Date()): AgeBand {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || '');
  if (!m) return '';
  const [, y, mo, d] = m.map(Number);
  let age = now.getUTCFullYear() - y;
  if ((now.getUTCMonth() + 1) * 100 + now.getUTCDate() < mo * 100 + d) age -= 1;
  if (age < 0 || age > 130) return '';
  if (age < 13) return 'child';
  if (age < 18) return 'minor';
  return 'adult';
}

export function isProfileComplete(p: Profile | null): boolean {
  return !!(p && p.displayName && /^\d{4}-\d{2}-\d{2}$/.test(p.dob) && p.consentDpdp);
}
