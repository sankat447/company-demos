/**
 * Visitor profile (Phase 1): the DPDP-consented name + DOB used to derive the
 * master-ticket age-band. DOB stays server-side; only the age-band ever travels
 * in the QR. The pure helpers (age-band) live in ageBand.ts so they stay
 * unit-testable without pulling the Amplify gql client.
 */
import { GET_PROFILE, gqlClient, SET_PROFILE } from '@/api/graphql';

import type { Profile } from './ageBand';

export { ageBandFromDob, isProfileComplete } from './ageBand';
export type { AgeBand, Profile } from './ageBand';

export async function loadProfile(): Promise<Profile | null> {
  const res = (await gqlClient().graphql({ query: GET_PROFILE })) as {
    data?: { getProfile?: Profile | null };
  };
  return res.data?.getProfile ?? null;
}

export async function saveProfile(input: Profile): Promise<Profile> {
  const res = (await gqlClient().graphql({ query: SET_PROFILE, variables: { input } })) as {
    data?: { setProfile?: Profile };
  };
  return res.data?.setProfile ?? input;
}
