import {
  reminderTimeMs,
  toggleReminder,
  type Notifier,
} from '@/features/cultural-nights/reminders';
import {
  parseScheduleRow,
  sortEvents,
  type ScheduleEvent,
  type ScheduleRow,
} from '@/features/cultural-nights/schedule';
import { castVote, votedEventIds } from '@/features/cultural-nights/votes';
import { parseVenues, fetchVenues, VENUES_MAX_AGE_MS } from '@/features/cultural-nights/venues';
import type { KvStore } from '@/offline/jwks';
import { MemoryOutboxStore } from '@/offline/outbox';

// venues.ts resolves the CDN domain through the contract accessor.
jest.mock('@/config/stack', () => ({
  cdnUrl: (path: string) => `https://cdn.test${path}`,
}));
// schedule.ts imports the db module for listEventsForDay (not under test
// here) — stub it so expo-sqlite's native chain stays out of the suite.
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

function row(overrides: Partial<ScheduleRow>): ScheduleRow {
  return {
    id: 'e1',
    day: '2026-11-21',
    venue: 'Chogan',
    starts_at: 1_763_740_000,
    ends_at: 1_763_743_600,
    title_en: 'Folk night',
    title_hi: 'लोक संध्या',
    data_json: null,
    ...overrides,
  };
}

describe('schedule parsing & ordering', () => {
  it('parses votable/seat flags from data_json and tolerates malformed extras', () => {
    const votable = parseScheduleRow(
      row({ data_json: JSON.stringify({ votable: true, category: 'dance' }) }),
    );
    expect(votable.votable).toBe(true);
    expect(votable.category).toBe('dance');

    const broken = parseScheduleRow(row({ data_json: '{not json' }));
    expect(broken.votable).toBe(false);
    expect(broken.titleEn).toBe('Folk night');
  });

  it('sorts chronologically with missing start times last', () => {
    const events: ScheduleEvent[] = [
      parseScheduleRow(row({ id: 'late', starts_at: 2000 })),
      parseScheduleRow(row({ id: 'tba', starts_at: null })),
      parseScheduleRow(row({ id: 'early', starts_at: 1000 })),
    ];
    expect(sortEvents(events).map((e) => e.id)).toEqual(['early', 'late', 'tba']);
  });
});

describe('audience-favourite voting (outbox-safe)', () => {
  it('queues exactly one vote per user per event', async () => {
    const outbox = new MemoryOutboxStore();
    const kv = memoryKv();

    const first = await castVote(
      { outbox, kv },
      { sub: 'u1', eventId: 'e1', category: 'dance' },
      NOW_MS,
    );
    const second = await castVote({ outbox, kv }, { sub: 'u1', eventId: 'e1' }, NOW_MS + 10);

    expect(first).toBe('queued');
    expect(second).toBe('already-voted');
    expect(await outbox.pendingCount()).toBe(1);

    const [head] = await outbox.dueHeads(NOW_MS + 20);
    expect(head.aggregate).toBe('votes:u1');
    expect(head.mutation).toBe('castVote');
    expect(head.idempotencyKey).toBe('vote:u1:e1');
    expect(head.variables).toEqual({ eventId: 'e1', category: 'dance' });

    expect(Object.keys(await votedEventIds(kv))).toEqual(['e1']);
  });

  it('different events and users queue independently', async () => {
    const outbox = new MemoryOutboxStore();
    const kv = memoryKv();
    await castVote({ outbox, kv }, { sub: 'u1', eventId: 'e1' }, NOW_MS);
    await castVote({ outbox, kv }, { sub: 'u1', eventId: 'e2' }, NOW_MS);
    expect(await outbox.pendingCount()).toBe(2);
  });
});

describe('reminders', () => {
  const event = parseScheduleRow(row({ starts_at: Math.floor(NOW_MS / 1000) + 3600 }));

  function fakeNotifier(granted = true) {
    const scheduled: { title: string; dateMs: number }[] = [];
    const cancelled: string[] = [];
    const notifier: Notifier = {
      async requestPermissions() {
        return granted;
      },
      async schedule({ title, dateMs }) {
        scheduled.push({ title, dateMs });
        return `notif-${scheduled.length}`;
      },
      async cancel(id) {
        cancelled.push(id);
      },
    };
    return { notifier, scheduled, cancelled };
  }

  it('fires leadMinutes before start, never in the past', () => {
    const startsAtSec = Math.floor(NOW_MS / 1000) + 3600;
    expect(reminderTimeMs(startsAtSec, NOW_MS, 30)).toBe(startsAtSec * 1000 - 30 * 60_000);
    expect(reminderTimeMs(Math.floor(NOW_MS / 1000) + 60, NOW_MS, 30)).toBeNull();
  });

  it('toggles on (schedules) then off (cancels), persisting the mapping', async () => {
    const kv = memoryKv();
    const { notifier, scheduled, cancelled } = fakeNotifier();

    const on = await toggleReminder(
      kv,
      event,
      { title: 'Folk night', body: 'Chogan' },
      NOW_MS,
      notifier,
    );
    expect(on).toBe('on');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].dateMs).toBe((event.startsAtSec ?? 0) * 1000 - 30 * 60_000);

    const off = await toggleReminder(
      kv,
      event,
      { title: 'Folk night', body: 'Chogan' },
      NOW_MS,
      notifier,
    );
    expect(off).toBe('off');
    expect(cancelled).toEqual(['notif-1']);
  });

  it('reports permission-denied without scheduling', async () => {
    const kv = memoryKv();
    const { notifier, scheduled } = fakeNotifier(false);
    const result = await toggleReminder(kv, event, { title: 't', body: 'b' }, NOW_MS, notifier);
    expect(result).toBe('permission-denied');
    expect(scheduled).toHaveLength(0);
  });
});

describe('venues config (CDN, kv-cached)', () => {
  const body = { venues: [{ id: 'chogan', nameEn: 'Chogan Ground', lat: 32.05, lng: 76.72 }] };

  it('parses and drops malformed entries', () => {
    const parsed = parseVenues({ venues: [...body.venues, { id: 'bad' }] });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('chogan');
  });

  it('serves cache when fresh and falls back to stale cache offline', async () => {
    const kv = memoryKv();
    let calls = 0;
    const okFetch = (async () => {
      calls += 1;
      return { ok: true, json: async () => body } as Response;
    }) as typeof fetch;

    const first = await fetchVenues(kv, NOW_MS, okFetch);
    const second = await fetchVenues(kv, NOW_MS + 1000, okFetch); // fresh → no refetch
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(calls).toBe(1);

    const failFetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const stale = await fetchVenues(kv, NOW_MS + VENUES_MAX_AGE_MS + 1, failFetch);
    expect(stale).toHaveLength(1); // stale pins beat no pins
  });
});
