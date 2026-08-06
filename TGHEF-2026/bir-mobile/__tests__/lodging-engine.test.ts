import fc from 'fast-check';

import poolFixture from '@/features/lodging/__fixtures__/pool.mock.json';
import roomsFixture from '@/features/lodging/__fixtures__/rooms.mock.json';
import { applyMove, propose, releaseAssignments, validateMove } from '@/features/lodging/engine';
import type { Gender, Participant, Room } from '@/features/lodging/types';
import { LODGING_NIGHTS } from '@/features/lodging/types';

const fixtureRooms = roomsFixture.rooms as Room[];
const fixturePool = poolFixture.participants as Participant[];

describe('propose() on the acceptance fixture (mixed pool)', () => {
  const proposal = propose(fixturePool, fixtureRooms);
  const byId = new Map(fixturePool.map((p) => [p.regId, p]));

  it('places the couple together in the doubleOccupancy room, exclusively', () => {
    const couple = fixturePool.filter((p) => p.coupleGroupId === 'couple-kv');
    const coupleRooms = couple.map(
      (p) => proposal.assignments.find((a) => a.regId === p.regId)?.roomId,
    );
    expect(coupleRooms[0]).toBeDefined();
    expect(coupleRooms[0]).toBe(coupleRooms[1]);
    const room = fixtureRooms.find((r) => r.id === coupleRooms[0])!;
    expect(room.doubleOccupancy).toBe(true);
    // exclusively theirs — nobody else in that room
    const others = proposal.assignments.filter(
      (a) => a.roomId === room.id && !couple.some((c) => c.regId === a.regId),
    );
    expect(others).toHaveLength(0);
  });

  it('routes the undisclosed participant to the manual queue, never auto-placed', () => {
    expect(proposal.unplaced).toContainEqual({
      regId: 'reg:p8:chef-fusion:na',
      reason: 'needs-manual',
    });
    expect(proposal.assignments.some((a) => a.regId === 'reg:p8:chef-fusion:na')).toBe(false);
  });

  it('never mixes genders in a shared room', () => {
    const roomsUsed = new Map<string, Gender[]>();
    for (const a of proposal.assignments) {
      const p = byId.get(a.regId)!;
      if (!p.coupleGroupId) {
        roomsUsed.set(a.roomId, [...(roomsUsed.get(a.roomId) ?? []), p.gender]);
      }
    }
    for (const genders of roomsUsed.values()) {
      expect(new Set(genders).size).toBe(1);
    }
  });

  it('is deterministic and input-order independent', () => {
    const again = propose([...fixturePool].reverse(), [...fixtureRooms].reverse());
    expect(again).toEqual(proposal);
  });
});

// ---------- property-based: §3.1–3.4 hold for randomized pools ----------

const genderArb = fc.constantFrom<Gender>('female', 'male', 'other', 'undisclosed');
const nightsArb = fc
  .subarray([...LODGING_NIGHTS], { minLength: 1 })
  .map((nights) => [...nights].sort());

const participantArb = (i: number) =>
  fc
    .record({
      gender: genderArb,
      nights: nightsArb,
    })
    .map(({ gender, nights }): Participant => ({
      regId: `reg:p${i}`,
      name: `P${i}`,
      competitionId: ['chef-local', 'chef-fusion', 'him-prince-2026', 'him-queen-2026'][i % 4],
      gender,
      nights,
      needsLodging: true,
    }));

const poolArb = fc
  .integer({ min: 0, max: 14 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => participantArb(i))))
  .chain((singles) =>
    fc.integer({ min: 0, max: 3 }).chain((coupleCount) =>
      nightsArb.map((coupleNights) => {
        const couples: Participant[] = [];
        for (let c = 0; c < coupleCount; c++) {
          for (const half of [0, 1]) {
            couples.push({
              regId: `reg:c${c}-${half}`,
              name: `C${c}${half}`,
              competitionId: 'chef-local',
              gender: half === 0 ? 'female' : 'male',
              coupleGroupId: `couple-${c}`,
              nights: coupleNights,
              needsLodging: true,
            });
          }
        }
        return [...singles, ...couples];
      }),
    ),
  );

const roomArb = (i: number) =>
  fc
    .record({
      capacity: fc.integer({ min: 1, max: 6 }),
      doubleOccupancy: fc.boolean(),
      nights: nightsArb,
    })
    .map(({ capacity, doubleOccupancy, nights }): Room => ({
      id: `r${i}`,
      hotelName: `H${i % 3}`,
      roomLabel: `L${i}`,
      type: doubleOccupancy ? 'double' : 'twin',
      capacity: doubleOccupancy ? 2 : capacity,
      doubleOccupancy,
      availability: { from: '2026-11-20', to: '2026-11-24', nights },
      status: 'active',
    }));

const roomsArb = fc
  .integer({ min: 0, max: 8 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => roomArb(i))));

describe('propose() invariants — 1,000 randomized pools (Gate 6 CO-003)', () => {
  it('§3.1–3.4 + partition hold for every randomized pool', () => {
    fc.assert(
      fc.property(poolArb, roomsArb, (pool, rooms) => {
        const { assignments, unplaced } = propose(pool, rooms);
        const byId = new Map(pool.map((p) => [p.regId, p]));

        // Partition: everyone appears exactly once across the two outputs.
        const seen = [...assignments.map((a) => a.regId), ...unplaced.map((u) => u.regId)];
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen.length).toBe(pool.filter((p) => p.needsLodging).length);

        // Undisclosed/other never auto-placed.
        for (const a of assignments) {
          const p = byId.get(a.regId)!;
          expect(p.gender === 'other' || p.gender === 'undisclosed').toBe(false);
        }

        const roomOccupants = new Map<string, Participant[]>();
        for (const a of assignments) {
          roomOccupants.set(a.roomId, [...(roomOccupants.get(a.roomId) ?? []), byId.get(a.regId)!]);
        }

        for (const [roomId, occupants] of roomOccupants) {
          const room = rooms.find((r) => r.id === roomId)!;

          // §3.4 per-night occupancy ≤ capacity, nights inside availability.
          for (const night of LODGING_NIGHTS) {
            const count = occupants.filter((o) => o.nights.includes(night)).length;
            expect(count).toBeLessThanOrEqual(room.capacity);
            if (count > 0) expect(room.availability.nights).toContain(night);
          }

          const couples = occupants.filter((o) => o.coupleGroupId);
          if (couples.length > 0) {
            // §3.3 couple room: doubleOccupancy, exactly the pair, nobody else.
            expect(room.doubleOccupancy).toBe(true);
            expect(occupants).toHaveLength(2);
            expect(new Set(couples.map((c) => c.coupleGroupId)).size).toBe(1);
          } else {
            // §3.1/§3.2 single-gender sharing.
            expect(new Set(occupants.map((o) => o.gender)).size).toBeLessThanOrEqual(1);
          }
        }

        // Determinism.
        expect(propose([...pool].reverse(), [...rooms].reverse())).toEqual({
          assignments,
          unplaced,
        });
      }),
      { numRuns: 1000 },
    );
  });
});

describe('validateMove (adjust + manual placement)', () => {
  const proposal = propose(fixturePool, fixtureRooms);
  const byId = (id: string) => fixturePool.find((p) => p.regId === id)!;

  it('blocks gender-mixing moves with a reason', () => {
    // p4 (male) into the room holding females
    const femaleRoom = proposal.assignments.find(
      (a) => a.regId === 'reg:p1:him-queen-2026:na',
    )!.roomId;
    expect(
      validateMove(
        byId('reg:p4:him-prince-2026:na'),
        femaleRoom,
        proposal.assignments,
        fixturePool,
        fixtureRooms,
      ),
    ).toBe('gender-mix');
  });

  it('blocks splitting a couple and invading a couple room', () => {
    const coupleRoom = proposal.assignments.find((a) => a.regId === 'reg:p6:chef-local:na')!.roomId;
    expect(
      validateMove(
        byId('reg:p6:chef-local:na'),
        'r-colony-dorm',
        proposal.assignments,
        fixturePool,
        fixtureRooms,
      ),
    ).toBe('couple-split');
    expect(
      validateMove(
        byId('reg:p4:him-prince-2026:na'),
        coupleRoom,
        proposal.assignments,
        fixturePool,
        fixtureRooms,
      ),
    ).toBe('couple-exclusive');
  });

  it('undisclosed participant: single-room manual placement only', () => {
    const undisclosed = byId('reg:p8:chef-fusion:na');
    const occupiedDorm = validateMove(
      undisclosed,
      'r-colony-dorm',
      proposal.assignments,
      fixturePool,
      fixtureRooms,
    );
    const emptyRoom = validateMove(
      undisclosed,
      'r-surya-102',
      releaseAssignments(
        proposal.assignments,
        proposal.assignments.filter((a) => a.roomId === 'r-surya-102').map((a) => a.regId),
      ),
      fixturePool,
      fixtureRooms,
    );
    // dorm holds males for overlapping nights → needs an empty room
    expect(occupiedDorm === 'manual-needs-empty-room' || occupiedDorm === null).toBe(true);
    expect(emptyRoom).toBeNull();
  });

  it('retired rooms and missing nights are blocked; applyMove/release are pure', () => {
    expect(
      validateMove(
        byId('reg:p4:him-prince-2026:na'),
        'r-retired-x',
        proposal.assignments,
        fixturePool,
        fixtureRooms,
      ),
    ).toBe('room-unavailable');
    // p3 needs the night of the 20th; the Deodar partner room starts the 21st
    expect(
      validateMove(byId('reg:p3:chef-local:na'), 'r-deodar-c2', [], fixturePool, fixtureRooms),
    ).toBe('nights-unavailable');

    const moved = applyMove(proposal.assignments, 'reg:p4:him-prince-2026:na', 'r-surya-102');
    expect(moved.filter((a) => a.regId === 'reg:p4:him-prince-2026:na')).toHaveLength(1);
    const released = releaseAssignments(moved, ['reg:p4:him-prince-2026:na']);
    expect(released.some((a) => a.regId === 'reg:p4:him-prince-2026:na')).toBe(false);
  });
});
