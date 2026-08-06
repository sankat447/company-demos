/**
 * Venue pins come from backend config on the CDN — never hardcoded
 * coordinates (CLAUDE.md maps decision). Cached in kv so the map renders
 * offline; see docs/BACKEND_ASKS.md #16 for the config file ask.
 */
import { cdnUrl } from '@/config/stack';
import type { KvStore } from '@/offline/jwks';

export interface Venue {
  id: string;
  nameEn: string;
  nameHi?: string | null;
  lat: number;
  lng: number;
}

const VENUES_KEY = 'venues.cache';
export const VENUES_MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface CachedVenues {
  fetchedAtMs: number;
  venues: Venue[];
}

export function parseVenues(body: unknown): Venue[] {
  const list = (body as { venues?: unknown })?.venues;
  if (!Array.isArray(list)) throw new Error('venues config: missing venues array');
  return list.filter(
    (v): v is Venue =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as Venue).id === 'string' &&
      typeof (v as Venue).nameEn === 'string' &&
      typeof (v as Venue).lat === 'number' &&
      typeof (v as Venue).lng === 'number',
  );
}

export async function fetchVenues(
  kv: KvStore,
  nowMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<Venue[]> {
  const rawCache = await kv.get(VENUES_KEY);
  let cached: CachedVenues | null = null;
  if (rawCache) {
    try {
      cached = JSON.parse(rawCache) as CachedVenues;
    } catch {
      cached = null;
    }
  }
  if (cached && nowMs - cached.fetchedAtMs < VENUES_MAX_AGE_MS) return cached.venues;

  try {
    const res = await fetchFn(cdnUrl('/config/venues.json'));
    if (!res.ok) throw new Error(`venues fetch failed: ${res.status}`);
    const venues = parseVenues(await res.json());
    await kv.set(VENUES_KEY, JSON.stringify({ fetchedAtMs: nowMs, venues } satisfies CachedVenues));
    return venues;
  } catch (err) {
    if (cached) return cached.venues; // offline → stale pins beat no pins
    throw err;
  }
}
