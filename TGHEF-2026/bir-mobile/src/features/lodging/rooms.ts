/**
 * Room inventory (P6.10). Local kv store seeded from the fixture behind
 * flags.mockLodging; the real CRUD is admin-guarded backend API (ASK #27 —
 * the server enforces the admin-hospitality group and audit-logs writes).
 */
import { gqlClient, LODGING_ROOMS } from '@/api/graphql';
import { isEnabled } from '@/config/flags';
import type { KvStore } from '@/offline/jwks';
import type { OutboxStore } from '@/offline/outbox';

import roomsFixture from './__fixtures__/rooms.mock.json';
import { LODGING_NIGHTS, type Room } from './types';

const ROOMS_KEY = 'lodging.rooms';

export type RoomError =
  | { field: 'hotelName' | 'roomLabel'; error: 'required' }
  | { field: 'capacity'; error: 'min-1' }
  | { field: 'doubleOccupancy'; error: 'double-implies-2' }
  | { field: 'availability'; error: 'outside-window' }
  | { field: 'roomLabel'; error: 'duplicate' };

export function validateRoom(room: Room, existing: Room[]): RoomError[] {
  const errors: RoomError[] = [];
  if (!room.hotelName.trim()) errors.push({ field: 'hotelName', error: 'required' });
  if (!room.roomLabel.trim()) errors.push({ field: 'roomLabel', error: 'required' });
  if (room.capacity < 1) errors.push({ field: 'capacity', error: 'min-1' });
  if (room.doubleOccupancy && room.capacity !== 2) {
    errors.push({ field: 'doubleOccupancy', error: 'double-implies-2' });
  }
  const window = new Set<string>(LODGING_NIGHTS);
  if (room.availability.nights.some((night) => !window.has(night))) {
    errors.push({ field: 'availability', error: 'outside-window' });
  }
  const key = (r: Room) =>
    `${r.hotelName.trim().toLowerCase()}::${r.roomLabel.trim().toLowerCase()}`;
  if (existing.some((r) => r.id !== room.id && key(r) === key(room))) {
    errors.push({ field: 'roomLabel', error: 'duplicate' });
  }
  return errors;
}

export interface RoomStore {
  list(): Promise<Room[]>;
  upsert(room: Room): Promise<RoomError[]>;
  setStatus(id: string, status: Room['status']): Promise<void>;
}

/**
 * Room store. Reads from the fixture (mock) or the backend (live, B2c); when an
 * `outbox` is supplied and live, writes are also queued to the admin-guarded
 * saveRoom/retireRoom mutations (B2d write-through) so edits persist server-side.
 */
export function kvRoomStore(kv: KvStore, outbox?: OutboxStore): RoomStore {
  const writeThrough = (mutation: string, variables: Record<string, unknown>, key: string) => {
    if (!outbox || isEnabled('mockLodging')) return Promise.resolve();
    const now = Date.now();
    return outbox.enqueue(
      { aggregate: `rooms:${variables.id as string}`, mutation, variables, idempotencyKey: key },
      now,
    );
  };
  async function read(): Promise<Room[]> {
    const rawValue = await kv.get(ROOMS_KEY);
    if (rawValue) {
      try {
        return JSON.parse(rawValue) as Room[];
      } catch {
        // fall through to seed
      }
    }
    // Mock mode seeds the fixture (incl. the partner complimentary room). Live
    // mode (B2c) fetches the admin-guarded lodgingRooms query and caches it.
    let seed: Room[];
    if (isEnabled('mockLodging')) {
      seed = roomsFixture.rooms as Room[];
    } else {
      const res = (await gqlClient().graphql({ query: LODGING_ROOMS })) as {
        data?: { lodgingRooms?: Room[] };
      };
      seed = res.data?.lodgingRooms ?? [];
    }
    await kv.set(ROOMS_KEY, JSON.stringify(seed));
    return seed;
  }
  return {
    list: read,
    async upsert(room) {
      const all = await read();
      const errors = validateRoom(room, all);
      if (errors.length) return errors;
      const next = all.filter((r) => r.id !== room.id);
      next.push(room);
      await kv.set(ROOMS_KEY, JSON.stringify(next));
      await writeThrough(
        'saveRoom',
        {
          id: room.id,
          hotelName: room.hotelName,
          propertyId: room.propertyId ?? null,
          roomLabel: room.roomLabel,
          type: room.type,
          capacity: room.capacity,
          doubleOccupancy: room.doubleOccupancy,
          availability: room.availability,
          amenitiesNote: room.amenitiesNote ?? null,
          contactPhone: room.contactPhone ?? null,
          status: room.status,
        },
        `room:save:${room.id}:${Date.now()}`,
      );
      return [];
    },
    async setStatus(id, status) {
      const all = await read();
      await kv.set(ROOMS_KEY, JSON.stringify(all.map((r) => (r.id === id ? { ...r, status } : r))));
      await writeThrough('retireRoom', { id, status }, `room:status:${id}:${status}:${Date.now()}`);
    },
  };
}

export function newRoomId(hotelName: string, roomLabel: string): string {
  const slug = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
  return `r-${slug(hotelName)}-${slug(roomLabel)}`;
}
