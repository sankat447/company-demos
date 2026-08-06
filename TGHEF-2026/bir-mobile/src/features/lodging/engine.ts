/**
 * CO-003 §3 allocation engine — PURE and deterministic. This produces a
 * SUGGESTION only; the commit is a backend mutation that re-validates the
 * same hard constraints server-side (ASK #29). Never trust the client alone.
 *
 * Hard constraints (never violated, even by auto-allocation):
 *   3.1 Female participants share only with female participants.
 *   3.2 Male participants share only with male participants.
 *   3.3 Registered couples stay together in a doubleOccupancy room that is
 *       exclusively theirs.
 *   3.4 One bed per participant per allocated night; per-night room
 *       occupancy never exceeds capacity.
 * Undisclosed/other gender — or anything the rules cannot place — is NEVER
 * auto-placed: it routes to the manual queue with the same dignity as the
 * main flow.
 */
import type { Assignment, Participant, Proposal, Room, Unplaced } from './types';

interface Ledger {
  room: Room;
  /** night → occupant regIds */
  occupants: Map<string, string[]>;
  /** gender lock once the first single is placed ('couple' for couple rooms) */
  lock: 'female' | 'male' | 'couple' | null;
}

function makeLedger(room: Room): Ledger {
  return { room, occupants: new Map(room.availability.nights.map((n) => [n, []])), lock: null };
}

function canHost(ledger: Ledger, nights: string[], headcount: number): boolean {
  return nights.every((night) => {
    const list = ledger.occupants.get(night);
    return list !== undefined && list.length + headcount <= ledger.room.capacity;
  });
}

function occupy(ledger: Ledger, nights: string[], regIds: string[]): void {
  for (const night of nights) {
    ledger.occupants.get(night)!.push(...regIds);
  }
}

const sameNights = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Deterministic first-fit-decreasing per night-set: couples → double rooms
 * first; then same-gender fill of twin/triple/dorm, clustering by
 * competition as a soft preference (sort order), never a constraint.
 */
export function propose(pool: Participant[], rooms: Room[]): Proposal {
  const assignments: Assignment[] = [];
  const unplaced: Unplaced[] = [];

  const ledgers = rooms
    .filter((r) => r.status === 'active')
    .sort((a, b) => b.capacity - a.capacity || a.id.localeCompare(b.id))
    .map(makeLedger);
  const doubles = ledgers.filter((l) => l.room.doubleOccupancy);
  const shared = ledgers.filter((l) => !l.room.doubleOccupancy);

  const lodgers = [...pool]
    .filter((p) => p.needsLodging)
    .sort((a, b) => a.regId.localeCompare(b.regId));

  // --- partition ---
  const couples = new Map<string, Participant[]>();
  const singles: Participant[] = [];
  for (const p of lodgers) {
    if (p.coupleGroupId) {
      couples.set(p.coupleGroupId, [...(couples.get(p.coupleGroupId) ?? []), p]);
    } else if (p.gender === 'female' || p.gender === 'male') {
      singles.push(p);
    } else {
      unplaced.push({ regId: p.regId, reason: 'needs-manual' });
    }
  }

  // --- couples → doubleOccupancy rooms, exclusively theirs (3.3) ---
  for (const groupId of [...couples.keys()].sort()) {
    const pair = couples.get(groupId)!;
    if (pair.length !== 2 || !sameNights(pair[0].nights, pair[1].nights)) {
      // Malformed link or differing night needs: the rules can't place it.
      for (const p of pair) unplaced.push({ regId: p.regId, reason: 'couple-mismatch' });
      continue;
    }
    const home = doubles.find((l) => l.lock === null && canHost(l, pair[0].nights, 2));
    if (!home) {
      for (const p of pair) unplaced.push({ regId: p.regId, reason: 'no-capacity' });
      continue;
    }
    home.lock = 'couple'; // no third bed assignment, ever
    occupy(
      home,
      pair[0].nights,
      pair.map((p) => p.regId),
    );
    for (const p of pair) assignments.push({ regId: p.regId, roomId: home.room.id });
  }

  // --- same-gender fill of twin/triple/dorm (3.1, 3.2, 3.4) ---
  for (const gender of ['female', 'male'] as const) {
    const group = singles
      .filter((p) => p.gender === gender)
      .sort(
        (a, b) => a.competitionId.localeCompare(b.competitionId) || a.regId.localeCompare(b.regId),
      );
    for (const p of group) {
      const home = shared.find(
        (l) => (l.lock === null || l.lock === gender) && canHost(l, p.nights, 1),
      );
      if (!home) {
        unplaced.push({ regId: p.regId, reason: 'no-capacity' });
        continue;
      }
      home.lock = gender;
      occupy(home, p.nights, [p.regId]);
      assignments.push({ regId: p.regId, roomId: home.room.id });
    }
  }

  return { assignments, unplaced };
}

// ---------- move validation (adjust step + manual placement) ----------

export type MoveViolation =
  | 'room-unavailable'
  | 'nights-unavailable'
  | 'capacity'
  | 'gender-mix'
  | 'couple-exclusive'
  | 'couple-split'
  | 'manual-needs-empty-room';

/**
 * Would moving `participant` into `roomId` violate §3? Used by the adjust UI
 * (inline block with EN+HI copy) and by manual placement. Returns null when
 * the move is legal. The same checks run server-side on commit (ASK #29).
 */
export function validateMove(
  participant: Participant,
  roomId: string,
  assignments: Assignment[],
  pool: Participant[],
  rooms: Room[],
): MoveViolation | null {
  const room = rooms.find((r) => r.id === roomId);
  if (!room || room.status !== 'active') return 'room-unavailable';

  const nightSet = new Set(room.availability.nights);
  if (!participant.nights.every((n) => nightSet.has(n))) return 'nights-unavailable';

  const byId = new Map(pool.map((p) => [p.regId, p]));
  const occupants = assignments
    .filter((a) => a.roomId === roomId && a.regId !== participant.regId)
    .map((a) => byId.get(a.regId))
    .filter((p): p is Participant => p !== undefined);

  // 3.3 couples — checked before capacity so the block explains the real
  // rule (a full couple room is "theirs", not merely "full").
  const occupantCouple = occupants.find((o) => o.coupleGroupId);
  if (participant.coupleGroupId) {
    if (!room.doubleOccupancy) return 'couple-split';
    const stranger = occupants.some((o) => o.coupleGroupId !== participant.coupleGroupId);
    if (stranger) return 'couple-exclusive';
    return null;
  }
  if (occupantCouple && room.doubleOccupancy) return 'couple-exclusive';

  // 3.4 capacity per night
  for (const night of participant.nights) {
    const count = occupants.filter((o) => o.nights.includes(night)).length;
    if (count + 1 > room.capacity) return 'capacity';
  }

  // Undisclosed/other: dignified single-room manual placement — a room of
  // their own for their nights (no forced gender classification).
  if (participant.gender === 'other' || participant.gender === 'undisclosed') {
    const overlapping = occupants.some((o) => o.nights.some((n) => participant.nights.includes(n)));
    return overlapping ? 'manual-needs-empty-room' : null;
  }

  // 3.1 / 3.2 same-gender sharing
  if (occupants.some((o) => o.gender !== participant.gender)) return 'gender-mix';
  return null;
}

/** Apply a validated move (pure): reassign or add the participant. */
export function applyMove(assignments: Assignment[], regId: string, roomId: string): Assignment[] {
  return [...assignments.filter((a) => a.regId !== regId), { regId, roomId }];
}

/** Cancellations free beds automatically: drop every assignment for regIds. */
export function releaseAssignments(assignments: Assignment[], regIds: string[]): Assignment[] {
  const gone = new Set(regIds);
  return assignments.filter((a) => !gone.has(a.regId));
}
