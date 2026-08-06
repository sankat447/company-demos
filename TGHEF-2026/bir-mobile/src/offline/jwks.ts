/**
 * JWKS fetch/cache/rotation for offline pass verification (P2.3).
 * Cached in the SQLite kv table; refreshed daily; the contract's issuerKid
 * must be present in any accepted key set (kid pinning).
 */
import { getStack, jwksUrl } from '@/config/stack';

import type { EcJwk } from './verifier';

export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const JWKS_KEY = 'jwks.cache';
export const JWKS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CachedJwks {
  fetchedAtMs: number;
  keys: EcJwk[];
}

function parseKeys(body: unknown): EcJwk[] {
  const keys = (body as { keys?: unknown })?.keys;
  if (!Array.isArray(keys)) throw new Error('JWKS: missing keys array');
  const ec = keys.filter(
    (k): k is EcJwk =>
      typeof k === 'object' &&
      k !== null &&
      (k as EcJwk).kty === 'EC' &&
      (k as EcJwk).crv === 'P-256' &&
      typeof (k as EcJwk).kid === 'string' &&
      typeof (k as EcJwk).x === 'string' &&
      typeof (k as EcJwk).y === 'string',
  );
  if (ec.length === 0) throw new Error('JWKS: no usable P-256 keys');
  const pinned = getStack().passes.issuerKid;
  if (!ec.some((k) => k.kid === pinned)) {
    throw new Error(`JWKS: pinned issuer kid "${pinned}" absent — refusing key set`);
  }
  return ec;
}

/** Seed the cache directly (demo mode / tests) — same shape refreshJwks writes. */
export async function primeJwksCache(kv: KvStore, keys: EcJwk[], nowMs: number): Promise<void> {
  await kv.set(JWKS_KEY, JSON.stringify({ fetchedAtMs: nowMs, keys } satisfies CachedJwks));
}

export async function getCachedJwks(kv: KvStore): Promise<CachedJwks | null> {
  const rawCache = await kv.get(JWKS_KEY);
  if (!rawCache) return null;
  try {
    return JSON.parse(rawCache) as CachedJwks;
  } catch {
    return null;
  }
}

export async function refreshJwks(
  kv: KvStore,
  nowMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<EcJwk[]> {
  const res = await fetchFn(jwksUrl());
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const keys = parseKeys(await res.json());
  await kv.set(JWKS_KEY, JSON.stringify({ fetchedAtMs: nowMs, keys } satisfies CachedJwks));
  return keys;
}

/**
 * Returns usable keys: refresh when stale, but fall back to the cache when
 * offline — a dead 4G link must never take gate scanning down with it.
 */
export async function ensureFreshJwks(
  kv: KvStore,
  nowMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<EcJwk[]> {
  const cached = await getCachedJwks(kv);
  const fresh = cached && nowMs - cached.fetchedAtMs < JWKS_MAX_AGE_MS;
  if (fresh) return cached.keys;
  try {
    return await refreshJwks(kv, nowMs, fetchFn);
  } catch (err) {
    if (cached) return cached.keys;
    throw err;
  }
}
