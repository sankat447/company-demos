import { festivalDayFor } from '@/features/cultural-nights/schedule';
import { getFlyStatus, parseFlyStatus } from '@/features/flight-status/flyStatus';
import { FALLBACK_EMERGENCY_PHONE, triggerSos } from '@/features/sos/sos';
import type { KvStore } from '@/offline/jwks';
import { MemoryOutboxStore } from '@/offline/outbox';

// Hermetic: modules under test take injected fetchers/deps; the real GraphQL
// module drags in Amplify's native chain, and schedule.ts drags in expo-sqlite.
jest.mock('@/api/graphql', () => ({
  gqlClient: jest.fn(),
  gqlSubscribe: jest.fn(),
  FLY_STATUS: 'FlyStatus',
  ON_FLY_STATUS_CHANGED: 'OnFlyStatusChanged',
}));
jest.mock('@/offline/db', () => ({
  getDb: jest.fn(),
  kvStore: { get: jest.fn(), set: jest.fn() },
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

const NOW_MS = 1_763_700_000_000;

describe('festivalDayFor (today feed)', () => {
  const ms = (iso: string) => new Date(`${iso}T12:00:00`).getTime();

  it('previews day 1 before the festival', () => {
    expect(festivalDayFor(ms('2026-11-01'))).toBe('2026-11-21');
  });
  it('tracks the current festival day', () => {
    expect(festivalDayFor(ms('2026-11-21'))).toBe('2026-11-21');
    expect(festivalDayFor(ms('2026-11-22'))).toBe('2026-11-22');
    expect(festivalDayFor(ms('2026-11-23'))).toBe('2026-11-23');
  });
  it('returns null once the festival is over (close-out state)', () => {
    expect(festivalDayFor(ms('2026-11-24'))).toBeNull();
    expect(festivalDayFor(ms('2026-12-01'))).toBeNull();
  });
});

describe('fly-status (official, cached last-known)', () => {
  const valid = {
    state: 'hold',
    reasonEn: 'Wind above limits',
    reasonHi: 'हवा सीमा से अधिक',
    updatedAt: 1_763_700_000,
    refundsAutoQueued: true,
  };

  it('parses valid payloads and rejects malformed ones', () => {
    const parsed = parseFlyStatus(valid);
    expect(parsed).toMatchObject({ state: 'hold', refundsAutoQueued: true });
    expect(parseFlyStatus({ state: 'maybe', updatedAt: 1 })).toBeNull();
    expect(parseFlyStatus({ state: 'hold' })).toBeNull();
    expect(parseFlyStatus(null)).toBeNull();
  });

  it('serves live status and caches it; falls back to cache when unreachable', async () => {
    const kv = memoryKv();
    const live = await getFlyStatus(kv, async () => valid);
    expect(live?.state).toBe('hold');

    const cached = await getFlyStatus(kv, async () => {
      throw new Error('offline');
    });
    expect(cached?.state).toBe('hold');
    expect(cached?.refundsAutoQueued).toBe(true);
  });

  it('returns null with no live status and an empty cache — never invents state', async () => {
    const kv = memoryKv();
    const status = await getFlyStatus(kv, async () => {
      throw new Error('offline');
    });
    expect(status).toBeNull();
  });
});

describe('SOS (call first, location once via outbox)', () => {
  it('dials the fallback emergency number and queues one location report', async () => {
    const outbox = new MemoryOutboxStore();
    const opened: string[] = [];

    const outcome = await triggerSos(
      {
        outbox,
        openUrl: async (url) => {
          opened.push(url);
        },
        getLocation: async () => ({ lat: 32.05, lng: 76.72 }),
      },
      { sub: 'u1', nowMs: NOW_MS },
    );

    expect(outcome).toEqual({ called: true, locationQueued: true });
    expect(opened).toEqual([`tel:${FALLBACK_EMERGENCY_PHONE}`]);

    const [head] = await outbox.dueHeads(NOW_MS);
    expect(head.mutation).toBe('reportSos');
    expect(head.aggregate).toBe('sos:u1');
    expect(head.variables).toEqual({ lat: 32.05, lng: 76.72, ts: NOW_MS / 1000 });
  });

  it('still calls when location consent is declined — nothing queued', async () => {
    const outbox = new MemoryOutboxStore();
    const outcome = await triggerSos(
      {
        outbox,
        openUrl: async () => {},
        getLocation: async () => null,
      },
      { sub: 'u1', nowMs: NOW_MS },
    );
    expect(outcome).toEqual({ called: true, locationQueued: false });
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('queues the location report even when the dialer fails', async () => {
    const outbox = new MemoryOutboxStore();
    const outcome = await triggerSos(
      {
        outbox,
        openUrl: async () => {
          throw new Error('no dialer on kiosk');
        },
        getLocation: async () => ({ lat: 1, lng: 2 }),
      },
      { sub: 'kiosk-1', nowMs: NOW_MS },
    );
    expect(outcome).toEqual({ called: false, locationQueued: true });
    expect(await outbox.pendingCount()).toBe(1);
  });
});
