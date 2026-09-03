/**
 * Allocation workflow state (P6.12): pool loading, committed assignments,
 * the participant-facing lodging card, and the printable hotel roster.
 * Commit rides the outbox (idempotent); the backend re-validates §3 and
 * audit-logs (ASK #29) — actorNote accompanies every manual override.
 */
import { gqlClient, LODGING_POOL } from '@/api/graphql';
import { isEnabled } from '@/config/flags';
import type { KvStore } from '@/offline/jwks';
import type { OutboxStore } from '@/offline/outbox';

import poolFixture from './__fixtures__/pool.mock.json';
import type { Assignment, Participant, Room } from './types';

const ALLOC_KEY = 'lodging.allocations';

/** The allocation pool (B2a). admin-hospitality-guarded server-side. */
export async function loadPool(): Promise<Participant[]> {
  if (isEnabled('mockLodging')) return poolFixture.participants as Participant[];
  const res = (await gqlClient().graphql({ query: LODGING_POOL })) as {
    data?: { lodgingPool?: Participant[] };
  };
  return res.data?.lodgingPool ?? [];
}

export interface CommittedAllocation {
  assignments: Assignment[];
  committedAtMs: number;
  version: number;
}

export async function loadAllocation(kv: KvStore): Promise<CommittedAllocation | null> {
  const rawValue = await kv.get(ALLOC_KEY);
  if (!rawValue) return null;
  try {
    return JSON.parse(rawValue) as CommittedAllocation;
  } catch {
    return null;
  }
}

/**
 * One mutation, one idempotency key per version. Post-commit reassignments
 * commit a new version (same constraint checks); participants re-notified
 * backend-side (push is Pinpoint's job — ASK #29 triggers it).
 */
export async function commitAllocation(
  deps: { kv: KvStore; outbox: OutboxStore },
  input: { sub: string; assignments: Assignment[]; actorNote?: string },
  nowMs: number,
): Promise<CommittedAllocation> {
  const previous = await loadAllocation(deps.kv);
  const version = (previous?.version ?? 0) + 1;
  await deps.outbox.enqueue(
    {
      aggregate: `lodging:${input.sub}`,
      mutation: 'commitAllocation',
      // assignments maps to the AWSJSON scalar — serialize (AppSync rejects a
      // raw array), same as highlights answers. The server re-parses + re-validates.
      variables: {
        assignments: JSON.stringify(input.assignments),
        version,
        actorNote: input.actorNote ?? null,
      },
      idempotencyKey: `alloc:${input.sub}:v${version}`,
    },
    nowMs,
  );
  const committed: CommittedAllocation = {
    assignments: input.assignments,
    committedAtMs: nowMs,
    version,
  };
  await deps.kv.set(ALLOC_KEY, JSON.stringify(committed));
  return committed;
}

export interface LodgingCard {
  hotelName: string;
  roomLabel: string;
  sharingType: string;
  contactPhone?: string;
  nights: string[];
}

/** Participant-facing card in My Registrations. Gender never appears. */
export function lodgingCardFor(
  regId: string,
  allocation: CommittedAllocation | null,
  rooms: Room[],
  pool: Participant[],
): LodgingCard | null {
  const assignment = allocation?.assignments.find((a) => a.regId === regId);
  if (!assignment) return null;
  const room = rooms.find((r) => r.id === assignment.roomId);
  const participant = pool.find((p) => p.regId === regId);
  if (!room || !participant) return null;
  return {
    hotelName: room.hotelName,
    roomLabel: room.roomLabel,
    sharingType: room.doubleOccupancy ? 'double' : room.type,
    contactPhone: room.contactPhone,
    nights: participant.nights,
  };
}

/** Printable per-hotel roster HTML: occupant NAMES ONLY (§5 privacy). */
export function rosterHtml(
  hotelName: string,
  rooms: Room[],
  allocation: CommittedAllocation,
  pool: Participant[],
): string {
  const byId = new Map(pool.map((p) => [p.regId, p]));
  const hotelRooms = rooms
    .filter((r) => r.hotelName === hotelName)
    .sort((a, b) => a.roomLabel.localeCompare(b.roomLabel));
  const rows = hotelRooms
    .map((room) => {
      const occupants = allocation.assignments
        .filter((a) => a.roomId === room.id)
        .map((a) => byId.get(a.regId))
        .filter((p): p is Participant => p !== undefined);
      if (!occupants.length) return '';
      const names = occupants
        .map(
          (p) =>
            `${p.name} <span class="n">(${p.nights.map((n) => n.slice(8)).join(', ')} Nov)</span>`,
        )
        .join('<br>');
      return `<tr><td>${room.roomLabel}</td><td>${names}</td></tr>`;
    })
    .join('');
  return `<html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,system-ui,sans-serif;color:#17232B;padding:24px}
    h1{font-size:18px;border-bottom:2px solid #E8A13D;padding-bottom:6px}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    td{border:1px solid #DCE4E0;padding:8px;font-size:12px;vertical-align:top}
    td:first-child{width:120px;font-weight:700}
    .n{color:#5D6B74;font-size:10px}
    footer{margin-top:16px;font-size:10px;color:#5D6B74}
  </style></head><body>
  <h1>Bir Festival 2026 — Participant roster · ${hotelName}</h1>
  <table>${rows}</table>
  <footer>Occupant names only. Generated by the festival hospitality desk.</footer>
  </body></html>`;
}
