/**
 * Partner self-service data (P5.2 food stalls, P5.3 hospitality). Read-mostly
 * consoles that mirror backend state (Step Functions for stall applications;
 * rooms/allocations for hospitality). Server-driven; fixtures behind
 * flags.mockPartner. Occupancy renders from cache offline (ARCHITECTURE §3).
 */
import { isEnabled } from '@/config/flags';

import hospitalityFixture from './__fixtures__/hospitality.mock.json';
import stallFixture from './__fixtures__/stall.mock.json';

// ---- food stall console ----
export type StallStage =
  'applied' | 'under-review' | 'approved' | 'payment-due' | 'allocated' | 'rejected';
export const STALL_STAGES: StallStage[] = [
  'applied',
  'under-review',
  'approved',
  'payment-due',
  'allocated',
];

export interface StallConsole {
  stallName: string;
  category: string;
  stage: StallStage;
  allocationLabel?: string;
  feeInr?: number;
  paid: boolean;
  analytics: { day: string; ordersEstimate: number; footfallIndex: number }[];
  rules: string[];
  rulesHi: string[];
}

export async function loadStallConsole(): Promise<StallConsole> {
  if (isEnabled('mockPartner')) return stallFixture as StallConsole;
  throw new Error('stall console unavailable — stallApplication query pending (ASK #34)');
}

/** Progress 0..1 through the approved pipeline (rejected → 0). */
export function stallProgress(stage: StallStage): number {
  if (stage === 'rejected') return 0;
  const idx = STALL_STAGES.indexOf(stage);
  return idx < 0 ? 0 : (idx + 1) / STALL_STAGES.length;
}

// ---- hospitality partner console ----
export interface Allocation {
  regId: string;
  guestName: string;
  roomLabel: string;
  nights: string[];
  checkedIn: boolean;
}

export interface HospitalityConsole {
  hotelName: string;
  tier: string;
  complimentaryRooms: number;
  allocations: Allocation[];
}

export async function loadHospitalityConsole(): Promise<HospitalityConsole> {
  if (isEnabled('mockPartner')) return hospitalityFixture as HospitalityConsole;
  throw new Error('hospitality console unavailable — allocations query pending (ASK #35)');
}

/** Occupancy summary for the board: occupied vs complimentary + total beds. */
export function occupancySummary(c: HospitalityConsole): { checkedIn: number; total: number } {
  return {
    checkedIn: c.allocations.filter((a) => a.checkedIn).length,
    total: c.allocations.length,
  };
}
