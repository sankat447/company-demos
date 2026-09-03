// rooms.ts imports the GraphQL client for the live read path (B2c); these tests
// run in mock mode, so stub the module to keep Amplify out.
jest.mock('@/api/graphql', () => ({ gqlClient: jest.fn(), LODGING_ROOMS: 'LODGING_ROOMS_DOC' }));

import { gqlClient } from '@/api/graphql';
import roomsFixture from '@/features/lodging/__fixtures__/rooms.mock.json';
import { kvRoomStore, newRoomId, validateRoom } from '@/features/lodging/rooms';
import type { Room } from '@/features/lodging/types';
import type { KvStore } from '@/offline/jwks';
import { MemoryOutboxStore } from '@/offline/outbox';

const mockClient = gqlClient as jest.Mock;

const flagValue = { mockLodging: true };
jest.mock('@/config/flags', () => ({
  isEnabled: (flag: string) => flagValue[flag as 'mockLodging'] === true,
}));

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

function room(overrides: Partial<Room> = {}): Room {
  return {
    id: 'r-test-1',
    hotelName: 'Test Hotel',
    roomLabel: '101',
    type: 'twin',
    capacity: 2,
    doubleOccupancy: false,
    availability: { from: '2026-11-20', to: '2026-11-24', nights: ['2026-11-21', '2026-11-22'] },
    status: 'active',
    ...overrides,
  };
}

describe('room validation (CO-003 §2 rules)', () => {
  it('capacity ≥ 1 and double ⇒ capacity 2', () => {
    expect(validateRoom(room({ capacity: 0 }), [])).toEqual([
      { field: 'capacity', error: 'min-1' },
    ]);
    expect(validateRoom(room({ doubleOccupancy: true, capacity: 3 }), [])).toEqual([
      { field: 'doubleOccupancy', error: 'double-implies-2' },
    ]);
    expect(validateRoom(room({ doubleOccupancy: true, capacity: 2, type: 'double' }), [])).toEqual(
      [],
    );
  });

  it('nights must sit inside the 20–24 Nov window', () => {
    const bad = room({
      availability: { from: '2026-11-19', to: '2026-11-25', nights: ['2026-11-19'] },
    });
    expect(validateRoom(bad, [])).toEqual([{ field: 'availability', error: 'outside-window' }]);
  });

  it('duplicate guard on (hotelName, roomLabel), case-insensitive, self-excluded', () => {
    const existing = room({ id: 'r-other', hotelName: 'Hotel Surya Classic', roomLabel: '204' });
    const dup = room({ id: 'r-new', hotelName: 'hotel surya classic', roomLabel: ' 204 ' });
    expect(validateRoom(dup, [existing])).toEqual([{ field: 'roomLabel', error: 'duplicate' }]);
    // editing the same room is not a duplicate of itself
    expect(validateRoom(existing, [existing])).toEqual([]);
  });
});

describe('room store', () => {
  it('seeds the fixture in mock mode, upserts with validation, retires', async () => {
    const store = kvRoomStore(memoryKv());
    const seeded = await store.list();
    expect(seeded.length).toBe(roomsFixture.rooms.length);

    const rejected = await store.upsert(
      room({
        id: newRoomId('Hotel Surya Classic', '101'),
        hotelName: 'Hotel Surya Classic',
        roomLabel: '101',
      }),
    );
    expect(rejected).toEqual([{ field: 'roomLabel', error: 'duplicate' }]);

    const ok = await store.upsert(
      room({ id: newRoomId('New Stay', 'A1'), hotelName: 'New Stay', roomLabel: 'A1' }),
    );
    expect(ok).toEqual([]);
    expect((await store.list()).length).toBe(seeded.length + 1);

    await store.setStatus(newRoomId('New Stay', 'A1'), 'retired');
    const after = await store.list();
    expect(after.find((r) => r.id === newRoomId('New Stay', 'A1'))?.status).toBe('retired');
  });
});

describe('room write-through (B2d)', () => {
  afterEach(() => {
    flagValue.mockLodging = true;
  });

  it('live mode: upsert queues saveRoom (availability stays a typed object)', async () => {
    flagValue.mockLodging = false;
    mockClient.mockReturnValue({
      graphql: jest.fn().mockResolvedValue({ data: { lodgingRooms: [] } }),
    });
    const outbox = new MemoryOutboxStore();
    const store = kvRoomStore(memoryKv(), outbox);
    expect(await store.upsert(room({ id: 'r-live-1' }))).toEqual([]);
    const [head] = await outbox.dueHeads(Date.now());
    expect(head.mutation).toBe('saveRoom');
    expect(head.variables.id).toBe('r-live-1');
    expect(head.variables.availability).toBeDefined();
  });

  it('live mode: retire queues retireRoom', async () => {
    flagValue.mockLodging = false;
    mockClient.mockReturnValue({
      graphql: jest.fn().mockResolvedValue({ data: { lodgingRooms: [] } }),
    });
    const outbox = new MemoryOutboxStore();
    const store = kvRoomStore(memoryKv(), outbox);
    await store.setStatus('r-live-2', 'retired');
    const [head] = await outbox.dueHeads(Date.now());
    expect(head.mutation).toBe('retireRoom');
    expect(head.variables).toEqual({ id: 'r-live-2', status: 'retired' });
  });

  it('mock mode: no write-through (kv only)', async () => {
    flagValue.mockLodging = true;
    const outbox = new MemoryOutboxStore();
    const store = kvRoomStore(memoryKv(), outbox);
    await store.upsert(room({ id: 'r-mock-1' }));
    expect(await outbox.dueHeads(Date.now())).toHaveLength(0);
  });
});
