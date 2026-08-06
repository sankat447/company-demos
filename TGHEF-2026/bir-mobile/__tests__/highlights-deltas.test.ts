import { issueDemoActivityPass, enableDemoSession, type DemoSeedDeps } from '@/demo/demo';
import mockCatalog from '@/features/highlights/__fixtures__/catalog.mock.json';
import { eventWindow } from '@/features/highlights/calendar';
import { parseCatalog, findItem } from '@/features/highlights/catalog';
import {
  cancelRegistration,
  kvRegistrationStore,
  submitFreeRegistration,
  weatherBlocked,
} from '@/features/highlights/registration';
import type { HighlightItem } from '@/features/highlights/types';
import type { KvStore } from '@/offline/jwks';
import { MemoryOutboxStore } from '@/offline/outbox';
import type { PassClaims } from '@/offline/verifier';
import { verifyPass } from '@/offline/verifier';

jest.mock('@/config/flags', () => ({ isEnabled: () => false }));

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

const catalog = parseCatalog(mockCatalog);
const byId = (id: string) => findItem(catalog, id)!;
const NOW_MS = 1_763_700_000_000;

describe('weather-hold gate (paragliding delta)', () => {
  const paragliding = byId('paragliding');
  const trekking = byId('trekking');

  it('blocks weather-sensitive items only, and only on hold/closed', () => {
    expect(weatherBlocked(paragliding, 'hold')).toBe(true);
    expect(weatherBlocked(paragliding, 'closed')).toBe(true);
    expect(weatherBlocked(paragliding, 'flying')).toBe(false);
    expect(weatherBlocked(paragliding, null)).toBe(false); // unknown ≠ hold
    expect(weatherBlocked(trekking, 'hold')).toBe(false); // not weather-sensitive
  });
});

describe('Nov 23 flip (CO-002 §8): both regModes ride the same engine', () => {
  it('view-only today; flipping the catalog value needs zero code changes', async () => {
    const nov23 = byId('night-23');
    expect(nov23.regMode).toBe('view-only');

    // The Convenor's alternative reading: same item, regMode flipped in the
    // catalog. The shared engine accepts it untouched.
    const flipped: HighlightItem = { ...nov23, regMode: 'register-participation' };
    const registration = await submitFreeRegistration(
      { outbox: new MemoryOutboxStore(), store: kvRegistrationStore(memoryKv()), mockMode: false },
      { sub: 'u1', item: flipped, answers: {} },
      NOW_MS,
    );
    expect(registration.status).toBe('pending-sync');
  });
});

describe('demo activity pass (typ: activity) into the shared wallet', () => {
  it('signs with the demo key and verifies through the REAL verifier', async () => {
    const kv = memoryKv();
    const jwks: Parameters<typeof verifyPass>[1] = [];
    const saved: { token: string; claims: PassClaims }[] = [];
    const deps: DemoSeedDeps = {
      kv,
      async primeJwks(_kv, keys) {
        jwks.push(...keys);
      },
      async savePass(token, claims) {
        saved.push({ token, claims });
      },
      async insertScheduleRow() {},
    };
    await enableDemoSession(deps, NOW_MS); // seeds + persists the signing key

    const jti = await issueDemoActivityPass(
      { kv, savePass: deps.savePass },
      { itemId: 'trekking', slotId: undefined, sub: 'demo-user' },
      NOW_MS,
    );
    expect(jti).toBe('demo-act-trekking-na');

    const activity = saved.find((p) => p.claims.typ === 'activity')!;
    const result = verifyPass(activity.token, jwks, Math.floor(NOW_MS / 1000));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.typ).toBe('activity');
  });

  it('returns null without a demo signing key (non-demo installs never mint)', async () => {
    const jti = await issueDemoActivityPass(
      { kv: memoryKv(), savePass: async () => {} },
      { itemId: 'trekking', sub: 'u1' },
      NOW_MS,
    );
    expect(jti).toBeNull();
  });
});

describe('cancel (ASK #24) and calendar window', () => {
  it('queues cancelRegistration and marks the record cancelled', async () => {
    const outbox = new MemoryOutboxStore();
    const store = kvRegistrationStore(memoryKv());
    const reg = await submitFreeRegistration(
      { outbox, store, mockMode: false },
      { sub: 'u1', item: byId('yoga-sunrise'), answers: {} },
      NOW_MS,
    );

    await cancelRegistration(
      { outbox, store, mockMode: false },
      { sub: 'u1', registrationId: reg.id },
      NOW_MS + 10,
    );

    const heads = await outbox.dueHeads(NOW_MS + 20);
    expect(heads.map((h) => h.mutation)).toContain('createRegistration'); // FIFO head first
    expect(await outbox.pendingCount()).toBe(2); // create + cancel, same aggregate
    const [stored] = await store.list();
    expect(stored.status).toBe('cancelled');
  });

  it('derives the calendar window from slot times, else first date evening', () => {
    const paragliding = byId('paragliding');
    const slotWindow = eventWindow(paragliding, paragliding.slots![0]);
    expect(slotWindow!.start.getTime()).toBe(paragliding.slots![0].startsAtSec * 1000);

    const yoga = byId('yoga-sunrise');
    const dateWindow = eventWindow(yoga);
    expect(dateWindow).not.toBeNull();
    expect(dateWindow!.end.getTime() - dateWindow!.start.getTime()).toBe(2 * 60 * 60 * 1000);
  });
});
