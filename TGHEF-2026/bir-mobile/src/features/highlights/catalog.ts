/**
 * Catalog loader (P5.6). Server-driven from `highlights.catalogPath`
 * (BACKEND_ASKS #21) once it exists; kv-cached so browsing works offline.
 * Until then the checked-in fixture serves behind `flags.mockHighlights`.
 */
import { isEnabled } from '@/config/flags';
import { highlightsCatalogUrl } from '@/config/stack';
import type { KvStore } from '@/offline/jwks';

import mockCatalog from './__fixtures__/catalog.mock.json';
import type { HighlightCategory, HighlightItem, HighlightsCatalog } from './types';

const CACHE_KEY = 'highlights.catalog';

/** Default remote source (B1): GET the server-driven catalog from the CDN. */
async function fetchCatalogFromCdn(): Promise<unknown> {
  const res = await fetch(highlightsCatalogUrl());
  if (!res.ok) throw new Error(`highlights catalog fetch failed: ${res.status}`);
  return res.json();
}

export function parseCatalog(body: unknown): HighlightsCatalog {
  const c = body as HighlightsCatalog;
  if (
    !c ||
    typeof c.version !== 'number' ||
    !Array.isArray(c.categories) ||
    !Array.isArray(c.items)
  ) {
    throw new Error('highlights catalog: malformed');
  }
  return c;
}

export async function loadCatalog(
  kv: KvStore,
  nowMs: number,
  fetchRemote?: () => Promise<unknown>,
): Promise<HighlightsCatalog> {
  if (isEnabled('mockHighlights')) {
    return parseCatalog(mockCatalog);
  }
  // Live path (B1): fetch the server-driven catalog (default source = CDN),
  // cache it, and fall back to the cache when offline.
  const fetcher = fetchRemote ?? fetchCatalogFromCdn;
  try {
    const catalog = parseCatalog(await fetcher());
    await kv.set(CACHE_KEY, JSON.stringify({ fetchedAtMs: nowMs, catalog }));
    return catalog;
  } catch {
    // fall through to cache
  }
  const rawCache = await kv.get(CACHE_KEY);
  if (rawCache) {
    try {
      return parseCatalog((JSON.parse(rawCache) as { catalog: unknown }).catalog);
    } catch {
      // corrupt cache → fall through
    }
  }
  throw new Error('highlights catalog unavailable — highlights.catalogPath pending (ASK #21)');
}

export function sortedCategories(catalog: HighlightsCatalog): HighlightCategory[] {
  return [...catalog.categories].sort((a, b) => a.order - b.order);
}

export function itemsForCategory(catalog: HighlightsCatalog, categoryId: string): HighlightItem[] {
  return catalog.items.filter((item) => item.categoryId === categoryId);
}

export function findItem(catalog: HighlightsCatalog, id: string): HighlightItem | null {
  return catalog.items.find((item) => item.id === id) ?? null;
}

export type CapacityState =
  | { state: 'open' }
  | { state: 'left'; remaining: number }
  | { state: 'waitlist' }
  | { state: 'view-only' };

/** Open / X left / Waitlist chip logic (live counters arrive with ASK #26). */
export function capacityState(item: HighlightItem): CapacityState {
  if (item.regMode === 'view-only') return { state: 'view-only' };
  const remaining =
    item.remaining ?? item.slots?.reduce((sum, slot) => sum + (slot.remaining ?? 0), 0);
  if (remaining === undefined) return { state: 'open' };
  if (remaining <= 0)
    return item.waitlist ? { state: 'waitlist' } : { state: 'left', remaining: 0 };
  return { state: 'left', remaining };
}
