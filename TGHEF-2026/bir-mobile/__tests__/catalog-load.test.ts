/**
 * B1: the Highlights catalog read path. With mockHighlights off, loadCatalog
 * fetches the server-driven catalog (default source = the CDN), caches it, and
 * falls back to the cache when offline.
 */
jest.mock('@/config/flags', () => ({ isEnabled: jest.fn() }));
jest.mock('@/config/stack', () => ({
  highlightsCatalogUrl: () => 'https://cdn.example/config/highlights/catalog.json',
}));

import { isEnabled } from '@/config/flags';
import { loadCatalog } from '@/features/highlights/catalog';

const mockEnabled = isEnabled as jest.Mock;

function memKv() {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

const REMOTE = {
  version: 7,
  categories: [
    { id: 'competitions', title: 'C', titleHi: 'C', icon: '🏆', order: 1, kind: 'competition' },
  ],
  items: [
    {
      id: 'night-21',
      categoryId: 'cultural-nights',
      title: 'Night',
      titleHi: 'रात',
      summary: 's',
      summaryHi: 's',
      venue: 'Chogan',
      dates: ['2026-11-21'],
      regMode: 'register-participation',
      formSchema: [],
    },
  ],
};

beforeEach(() => jest.clearAllMocks());

describe('loadCatalog', () => {
  it('returns the bundled fixture when mockHighlights is on (no network)', async () => {
    mockEnabled.mockReturnValue(true);
    const kv = memKv();
    const catalog = await loadCatalog(kv, 1000, async () => {
      throw new Error('should not fetch in mock mode');
    });
    expect(catalog.categories.length).toBeGreaterThan(0);
    expect(catalog.items.length).toBeGreaterThan(0);
  });

  it('fetches + caches the remote catalog when mock is off', async () => {
    mockEnabled.mockReturnValue(false);
    const kv = memKv();
    const catalog = await loadCatalog(kv, 1000, async () => REMOTE);
    expect(catalog.version).toBe(7);
    // cached for offline reuse
    const cached = await kv.get('highlights.catalog');
    expect(cached).toContain('"version":7');
  });

  it('falls back to the cache when the fetch fails (offline)', async () => {
    mockEnabled.mockReturnValue(false);
    const kv = memKv();
    await loadCatalog(kv, 1000, async () => REMOTE); // prime the cache
    const offline = await loadCatalog(kv, 2000, async () => {
      throw new Error('offline');
    });
    expect(offline.version).toBe(7);
  });

  it('throws when the fetch fails and no cache exists', async () => {
    mockEnabled.mockReturnValue(false);
    const kv = memKv();
    await expect(
      loadCatalog(kv, 1000, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow(/unavailable/);
  });

  it('uses the CDN via global fetch when no fetcher is passed (default source)', async () => {
    mockEnabled.mockReturnValue(false);
    const kv = memKv();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => REMOTE });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    const catalog = await loadCatalog(kv, 1000);
    expect(catalog.version).toBe(7);
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/config/highlights/catalog.json');
  });
});
