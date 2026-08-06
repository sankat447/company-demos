import poolFixture from '@/features/lodging/__fixtures__/pool.mock.json';
import roomsFixture from '@/features/lodging/__fixtures__/rooms.mock.json';
import {
  commitAllocation,
  loadAllocation,
  lodgingCardFor,
  rosterHtml,
} from '@/features/lodging/allocation';
import { propose } from '@/features/lodging/engine';
import type { Participant, Room } from '@/features/lodging/types';
import type { KvStore } from '@/offline/jwks';
import { MemoryOutboxStore } from '@/offline/outbox';

jest.mock('@/config/flags', () => ({ isEnabled: () => true }));

function memoryKv(): KvStore {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}

const rooms = roomsFixture.rooms as Room[];
const pool = poolFixture.participants as Participant[];
const NOW_MS = 1_763_700_000_000;

describe('commitAllocation (idempotent, versioned, audit-noted)', () => {
  it('queues one mutation per version with actorNote and persists locally', async () => {
    const kv = memoryKv();
    const outbox = new MemoryOutboxStore();
    const proposal = propose(pool, rooms);

    const v1 = await commitAllocation(
      { kv, outbox },
      { sub: 'admin1', assignments: proposal.assignments, actorNote: 'initial run' },
      NOW_MS,
    );
    expect(v1.version).toBe(1);

    const [head] = await outbox.dueHeads(NOW_MS);
    expect(head.mutation).toBe('commitAllocation');
    expect(head.idempotencyKey).toBe('alloc:admin1:v1');
    expect(head.variables.actorNote).toBe('initial run');

    // Post-commit reassignment → new version, new idempotency key.
    const v2 = await commitAllocation(
      { kv, outbox },
      { sub: 'admin1', assignments: proposal.assignments },
      NOW_MS + 10,
    );
    expect(v2.version).toBe(2);
    expect(await outbox.pendingCount()).toBe(2);
    expect((await loadAllocation(kv))?.version).toBe(2);
  });
});

describe('participant lodging card + hotel roster (§5 privacy)', () => {
  const proposal = propose(pool, rooms);
  const committed = { assignments: proposal.assignments, committedAtMs: NOW_MS, version: 1 };

  it('builds the card from allocation + room, no gender anywhere', () => {
    const anita = proposal.assignments.find((a) => a.regId === 'reg:p1:him-queen-2026:na')!;
    const card = lodgingCardFor(anita.regId, committed, rooms, pool)!;
    expect(card.hotelName).toBeTruthy();
    expect(card.roomLabel).toBeTruthy();
    expect(JSON.stringify(card)).not.toMatch(/female|male|gender/i);
    expect(lodgingCardFor('reg:none', committed, rooms, pool)).toBeNull();
  });

  it('roster shows occupant names only — never gender, never competition ids', () => {
    // Find the hotel that actually holds Anita (FFD may pick any hotel).
    const anitaRoom = rooms.find(
      (r) =>
        r.id === proposal.assignments.find((a) => a.regId === 'reg:p1:him-queen-2026:na')!.roomId,
    )!;
    const html = rosterHtml(anitaRoom.hotelName, rooms, committed, pool);
    expect(html).toContain(anitaRoom.hotelName);
    expect(html).toContain('Anita Thakur');
    expect(html).not.toMatch(/female|male|undisclosed/i);
    expect(html).not.toContain('him-queen-2026');
  });
});
