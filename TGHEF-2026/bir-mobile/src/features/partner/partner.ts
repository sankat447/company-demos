/**
 * Partner self-service data (P5.2 food stalls, P5.3 hospitality). Read-mostly
 * consoles that mirror backend state (Step Functions for stall applications;
 * rooms/allocations for hospitality). Types + pure helpers live here (kept
 * Amplify-free for unit tests); the GraphQL fetchers live in console.ts.
 */
import type { OutboxStore } from '@/offline/outbox';

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

/** Occupancy summary for the board: occupied vs complimentary + total beds. */
export function occupancySummary(c: HospitalityConsole): { checkedIn: number; total: number } {
  return {
    checkedIn: c.allocations.filter((a) => a.checkedIn).length,
    total: c.allocations.length,
  };
}

// ---- guest check-in (B4 GUI: persisted, offline-safe) ----
export interface GuestCheckIn {
  regId: string;
  checkedIn: boolean;
}

/**
 * Queue a hospitality guest check-in / out. Rides the outbox so a check-in at a
 * dead-signal front desk still syncs. The key carries nowMs so each tap is its
 * own write (a toggle isn't deduped); the server row is keyed by regId, so the
 * last write drained wins. A re-drain of one record replays the same key.
 */
export async function checkInGuest(
  outbox: OutboxStore,
  input: { sub: string; regId: string; checkedIn: boolean },
  nowMs: number,
): Promise<void> {
  await outbox.enqueue(
    {
      aggregate: `checkin:${input.sub}`,
      mutation: 'partnerCheckIn',
      variables: { regId: input.regId, checkedIn: input.checkedIn },
      idempotencyKey: `chkin:${input.sub}:${input.regId}:${nowMs}`,
    },
    nowMs,
  );
}

/** Overlay server check-in state onto the allocations (server wins per guest). */
export function mergeCheckIns(allocations: Allocation[], checkins: GuestCheckIn[]): Allocation[] {
  const map = new Map(checkins.map((c) => [c.regId, c.checkedIn]));
  return allocations.map((a) => (map.has(a.regId) ? { ...a, checkedIn: map.get(a.regId)! } : a));
}
