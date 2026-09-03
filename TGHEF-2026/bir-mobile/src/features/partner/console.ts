/**
 * B4: partner console fetchers. Kept out of the pure partner.ts (progress /
 * occupancy helpers) so those stay Amplify-free for unit tests — same split as
 * volunteers/roster.ts and highlights/myRegistrations.ts. Mock serves the
 * fixture; live calls the partner-guarded stallConsole / hospitalityConsole
 * queries and parses the AWSJSON analytics / allocations strings.
 */
import { gqlClient, HOSPITALITY_CONSOLE, STALL_CONSOLE } from '@/api/graphql';
import { isEnabled } from '@/config/flags';

import hospitalityFixture from './__fixtures__/hospitality.mock.json';
import stallFixture from './__fixtures__/stall.mock.json';
import type { Allocation, HospitalityConsole, StallConsole } from './partner';

/** AWSJSON arrives as a JSON string; parse to an array, tolerating bad data. */
function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function loadStallConsole(): Promise<StallConsole> {
  if (isEnabled('mockPartner')) return stallFixture as StallConsole;
  const res = (await gqlClient().graphql({ query: STALL_CONSOLE })) as {
    data?: { stallConsole?: (Omit<StallConsole, 'analytics'> & { analytics: unknown }) | null };
  };
  const raw = res.data?.stallConsole;
  if (!raw) throw new Error('stall console unavailable — no console for this account');
  return { ...raw, analytics: parseJsonArray(raw.analytics) };
}

export async function loadHospitalityConsole(): Promise<HospitalityConsole> {
  if (isEnabled('mockPartner')) return hospitalityFixture as HospitalityConsole;
  const res = (await gqlClient().graphql({ query: HOSPITALITY_CONSOLE })) as {
    data?: {
      hospitalityConsole?:
        (Omit<HospitalityConsole, 'allocations'> & { allocations: unknown }) | null;
    };
  };
  const raw = res.data?.hospitalityConsole;
  if (!raw) throw new Error('hospitality console unavailable — no console for this account');
  return { ...raw, allocations: parseJsonArray<Allocation>(raw.allocations) };
}
