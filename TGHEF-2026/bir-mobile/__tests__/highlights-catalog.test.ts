import mockCatalog from '@/features/highlights/__fixtures__/catalog.mock.json';
import {
  capacityState,
  itemsForCategory,
  loadCatalog,
  parseCatalog,
  sortedCategories,
} from '@/features/highlights/catalog';
import type { HighlightsCatalog } from '@/features/highlights/types';
import type { KvStore } from '@/offline/jwks';

const flagValue = { mockHighlights: true };
jest.mock('@/config/flags', () => ({
  isEnabled: (flag: string) => flagValue[flag as 'mockHighlights'] === true,
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

const catalog = parseCatalog(mockCatalog) as HighlightsCatalog;

describe('mock catalog matches the CO-002 §2 outline exactly', () => {
  it('has the six top-level categories in order', () => {
    expect(sortedCategories(catalog).map((c) => c.id)).toEqual([
      'competitions',
      'cultural-nights',
      'yoga-wellness',
      'pottery-art',
      'adventure',
      'sightseeing',
    ]);
  });

  it('competitions: the four named entries, Prince/Queen naming exact', () => {
    expect(itemsForCategory(catalog, 'competitions').map((i) => i.title)).toEqual([
      'Chef of the Year — Local Food',
      'Chef of the Year — Fusion',
      'Himalayan Prince 2026',
      'Himalayan Queen 2026',
    ]);
    expect(JSON.stringify(mockCatalog)).not.toMatch(/Princess/);
  });

  it('cultural nights: 21+22 take participation, 23 is view-only with agenda', () => {
    const nights = itemsForCategory(catalog, 'cultural-nights');
    expect(nights.map((n) => n.regMode)).toEqual([
      'register-participation',
      'register-participation',
      'view-only',
    ]);
    const nov23 = nights[2];
    expect(nov23.title).toBe('Nov 23 — Agenda');
    expect(nov23.agenda?.length).toBeGreaterThan(0);
  });

  it('adventure: the five §2 entries; paragliding is slot-based + weather-sensitive', () => {
    const adventure = itemsForCategory(catalog, 'adventure');
    expect(adventure.map((i) => i.title)).toEqual([
      'Trekking',
      'Paragliding',
      'Bungee Jumping',
      'Sky Cycle',
      'Burma Bridge',
    ]);
    const paragliding = adventure[1];
    expect(paragliding.slots?.length).toBeGreaterThan(1);
    expect(paragliding.weatherSensitive).toBe(true);
    expect(paragliding.gateChecked).toBe(true);
  });

  it('sightseeing: Tours around Bir with multiple departures via the slot mechanism', () => {
    const [tours] = itemsForCategory(catalog, 'sightseeing');
    expect(tours.title).toBe('Tours around Bir');
    expect(tours.slots?.length).toBeGreaterThan(1);
  });

  it('every item carries Hindi copy (parity is not just for i18n files)', () => {
    for (const item of catalog.items) {
      expect(item.titleHi.trim()).not.toBe('');
      expect(item.summaryHi.trim()).not.toBe('');
    }
  });
});

describe('capacity chips', () => {
  it('maps remaining/waitlist/view-only per CO-002 §3', () => {
    const byId = (id: string) => catalog.items.find((i) => i.id === id)!;
    expect(capacityState(byId('chef-local'))).toEqual({ state: 'left', remaining: 12 });
    expect(capacityState(byId('chef-fusion'))).toEqual({ state: 'waitlist' });
    expect(capacityState(byId('night-23'))).toEqual({ state: 'view-only' });
    expect(capacityState(byId('night-21'))).toEqual({ state: 'open' });
    // slot-based items sum their slots
    expect(capacityState(byId('paragliding'))).toEqual({ state: 'left', remaining: 20 });
  });
});

describe('catalog loader', () => {
  it('serves the fixture when flags.mockHighlights is on', async () => {
    const loaded = await loadCatalog(memoryKv(), 1);
    expect(loaded.items.length).toBe(catalog.items.length);
  });

  it('remote mode: caches on success and serves cache when offline', async () => {
    flagValue.mockHighlights = false;
    const kv = memoryKv();
    const remote = { version: 2, categories: catalog.categories, items: catalog.items.slice(0, 3) };

    const live = await loadCatalog(kv, 1, async () => remote);
    expect(live.version).toBe(2);

    const cached = await loadCatalog(kv, 2, async () => {
      throw new Error('offline');
    });
    expect(cached.version).toBe(2);
    expect(cached.items).toHaveLength(3);

    await expect(
      loadCatalog(memoryKv(), 3, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('ASK #21');
    flagValue.mockHighlights = true;
  });
});
