import { fileIncident, markAttendance, recordedAttendance } from '@/features/volunteers/volunteer';
import { declareFlyStatus } from '@/features/flight-status/setFlyStatus';
import {
  checkInGuest,
  mergeCheckIns,
  occupancySummary,
  stallProgress,
  type Allocation,
  type HospitalityConsole,
} from '@/features/partner/partner';
import type { KvStore } from '@/offline/jwks';
import { MemoryOutboxStore } from '@/offline/outbox';

jest.mock('@/config/flags', () => ({ isEnabled: () => true }));

function memoryKv(): KvStore {
  const map = new Map<string, string>();
  return {
    async get(k) {
      return map.get(k) ?? null;
    },
    async set(k, v) {
      map.set(k, v);
    },
  };
}
const NOW = 1_763_800_000_000;

describe('CO-004 volunteer attendance (P4.2, outbox-safe)', () => {
  it('check-in queues once and is idempotent per (shift, kind)', async () => {
    const kv = memoryKv();
    const outbox = new MemoryOutboxStore();
    const first = await markAttendance(
      { kv, outbox },
      { sub: 'v1', shiftId: 's1', kind: 'check-in' },
      NOW,
    );
    const again = await markAttendance(
      { kv, outbox },
      { sub: 'v1', shiftId: 's1', kind: 'check-in' },
      NOW + 100,
    );
    expect(first).toBe('recorded');
    expect(again).toBe('already');
    expect(await outbox.pendingCount()).toBe(1);

    const [head] = await outbox.dueHeads(NOW);
    expect(head.mutation).toBe('recordAttendance');
    expect(head.idempotencyKey).toBe('att:v1:s1:check-in');
    expect((await recordedAttendance(kv)).length).toBe(1);
  });

  it('check-out is a distinct mark from check-in', async () => {
    const kv = memoryKv();
    const outbox = new MemoryOutboxStore();
    await markAttendance({ kv, outbox }, { sub: 'v1', shiftId: 's1', kind: 'check-in' }, NOW);
    await markAttendance(
      { kv, outbox },
      { sub: 'v1', shiftId: 's1', kind: 'check-out' },
      NOW + 1000,
    );
    expect(await outbox.pendingCount()).toBe(2);
  });
});

describe('CO-004 incident reporting (P4.2)', () => {
  it('queues an incident with category + note + optional photo', async () => {
    const outbox = new MemoryOutboxStore();
    await fileIncident(
      outbox,
      { sub: 'v1', category: 'medical', note: 'fainting near stage', photoUri: 'file://x.jpg' },
      NOW,
    );
    const [head] = await outbox.dueHeads(NOW);
    expect(head.mutation).toBe('reportIncident');
    expect(head.aggregate).toBe('incidents:v1');
    expect(head.variables).toMatchObject({
      category: 'medical',
      note: 'fainting near stage',
      photoUri: 'file://x.jpg',
    });
  });
});

describe('CO-004 safety-officer fly-status declaration', () => {
  it('queues a setFlyStatus mutation carrying the declarer', async () => {
    const outbox = new MemoryOutboxStore();
    await declareFlyStatus(
      outbox,
      { sub: 'safety1', state: 'hold', reasonEn: 'wind', reasonHi: 'हवा' },
      NOW,
    );
    const [head] = await outbox.dueHeads(NOW);
    expect(head.mutation).toBe('setFlyStatus');
    expect(head.aggregate).toBe('flystatus:declare');
    expect(head.variables).toMatchObject({ state: 'hold', declaredBy: 'safety1' });
  });
});

describe('CO-004 partner consoles (P5.2 / P5.3)', () => {
  it('stall pipeline progress is monotonic and rejected is zero', () => {
    expect(stallProgress('applied')).toBeLessThan(stallProgress('approved'));
    expect(stallProgress('allocated')).toBe(1);
    expect(stallProgress('rejected')).toBe(0);
  });

  it('hospitality occupancy summary counts checked-in guests', () => {
    const c: HospitalityConsole = {
      hotelName: 'H',
      tier: 't',
      complimentaryRooms: 2,
      allocations: [
        { regId: 'a', guestName: 'A', roomLabel: '1', nights: ['2026-11-21'], checkedIn: true },
        { regId: 'b', guestName: 'B', roomLabel: '2', nights: ['2026-11-21'], checkedIn: false },
      ],
    };
    expect(occupancySummary(c)).toEqual({ checkedIn: 1, total: 2 });
  });

  it('guest check-in queues partnerCheckIn (outbox) and toggles are distinct writes', async () => {
    const outbox = new MemoryOutboxStore();
    await checkInGuest(outbox, { sub: 'h1', regId: 'a', checkedIn: true }, NOW);
    await checkInGuest(outbox, { sub: 'h1', regId: 'a', checkedIn: false }, NOW + 1);
    const heads = await outbox.dueHeads(NOW + 2);
    // same aggregate (FIFO), one head due; both are queued (distinct keys)
    expect(await outbox.pendingCount()).toBe(2);
    expect(heads[0].mutation).toBe('partnerCheckIn');
    expect(heads[0].variables).toEqual({ regId: 'a', checkedIn: true });
  });

  it('mergeCheckIns overlays server state per guest (server wins)', () => {
    const allocations: Allocation[] = [
      { regId: 'a', guestName: 'A', roomLabel: '1', nights: [], checkedIn: false },
      { regId: 'b', guestName: 'B', roomLabel: '2', nights: [], checkedIn: true },
    ];
    const merged = mergeCheckIns(allocations, [
      { regId: 'a', checkedIn: true },
      { regId: 'b', checkedIn: false },
    ]);
    expect(merged.map((m) => m.checkedIn)).toEqual([true, false]);
  });
});
