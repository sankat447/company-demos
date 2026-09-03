/**
 * B3: the volunteer roster fetch. Kept out of the pure volunteer.ts (attendance
 * + incident logic) so those stay Amplify-free for unit tests — same split as
 * highlights/myRegistrations.ts and badges/issue.ts. Mock mode serves the
 * fixture; live calls the volunteerRoster query (the caller's own profile).
 */
import { gqlClient, VOLUNTEER_ROSTER } from '@/api/graphql';
import { isEnabled } from '@/config/flags';

import rosterFixture from './__fixtures__/roster.mock.json';
import type { VolunteerProfile } from './volunteer';

export async function loadRoster(): Promise<VolunteerProfile> {
  if (isEnabled('mockVolunteer')) return rosterFixture as VolunteerProfile;
  // Live: the volunteerRoster query returns the caller's own profile, keyed
  // server-side by their Cognito sub (never another volunteer's).
  const res = (await gqlClient().graphql({ query: VOLUNTEER_ROSTER })) as {
    data?: { volunteerRoster?: VolunteerProfile | null };
  };
  const roster = res.data?.volunteerRoster;
  if (!roster) throw new Error('volunteer roster unavailable — no profile for this account');
  return roster;
}
