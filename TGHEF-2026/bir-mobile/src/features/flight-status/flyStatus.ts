/**
 * Official "Can I fly today?" status (P3.3, CO-001 E3). One source of truth:
 * the safety officer's call, fanned out by the backend. The app renders state
 * and notifies — it never infers flyability, and refund queueing for affected
 * flight bookings is backend-driven (the banner only reflects it).
 *
 * Guardrail: AI suggests, humans decide; the safety officer's "no fly" is final.
 */
import { FLY_STATUS, gqlClient, gqlSubscribe, ON_FLY_STATUS_CHANGED } from '@/api/graphql';
import type { KvStore } from '@/offline/jwks';

export type FlyState = 'flying' | 'hold' | 'closed';

export interface FlyStatus {
  state: FlyState;
  reasonEn?: string | null;
  reasonHi?: string | null;
  /** AWSTimestamp — seconds. */
  updatedAtSec: number;
  /** Affected flight bookings auto-enter the refund queue (backend-driven). */
  refundsAutoQueued: boolean;
}

const FLY_STATES: FlyState[] = ['flying', 'hold', 'closed'];
const CACHE_KEY = 'flystatus.cache';

export function parseFlyStatus(body: unknown): FlyStatus | null {
  const s = body as {
    state?: unknown;
    reasonEn?: string | null;
    reasonHi?: string | null;
    updatedAt?: unknown;
    refundsAutoQueued?: unknown;
  } | null;
  if (!s || !FLY_STATES.includes(s.state as FlyState) || typeof s.updatedAt !== 'number') {
    return null;
  }
  return {
    state: s.state as FlyState,
    reasonEn: s.reasonEn ?? null,
    reasonHi: s.reasonHi ?? null,
    updatedAtSec: s.updatedAt,
    refundsAutoQueued: s.refundsAutoQueued === true,
  };
}

async function readCache(kv: KvStore): Promise<FlyStatus | null> {
  const rawValue = await kv.get(CACHE_KEY);
  if (!rawValue) return null;
  try {
    return JSON.parse(rawValue) as FlyStatus;
  } catch {
    return null;
  }
}

async function writeCache(kv: KvStore, status: FlyStatus): Promise<void> {
  await kv.set(CACHE_KEY, JSON.stringify(status));
}

type FetchStatus = () => Promise<unknown>;

async function queryFlyStatus(): Promise<unknown> {
  const res = (await gqlClient().graphql({ query: FLY_STATUS })) as {
    data?: { flyStatus?: unknown };
  };
  return res.data?.flyStatus ?? null;
}

/** Live status when reachable; cached last-known otherwise (never invented). */
export async function getFlyStatus(
  kv: KvStore,
  fetchStatus: FetchStatus = queryFlyStatus,
): Promise<FlyStatus | null> {
  try {
    const status = parseFlyStatus(await fetchStatus());
    if (status) {
      await writeCache(kv, status);
      return status;
    }
  } catch {
    // fall through to cache
  }
  return readCache(kv);
}

/**
 * Subscribe to the fanout — the banner must flip the moment the safety
 * officer calls it. Newer events win; stale/malformed ones are dropped.
 */
export function subscribeFlyStatus(
  kv: KvStore,
  onChange: (status: FlyStatus) => void,
  subscribe = gqlSubscribe,
): () => void {
  const sub = subscribe({ query: ON_FLY_STATUS_CHANGED }).subscribe({
    next(value) {
      const status = parseFlyStatus(
        (value as { data?: { onFlyStatusChanged?: unknown } }).data?.onFlyStatusChanged,
      );
      if (!status) return;
      void writeCache(kv, status);
      onChange(status);
    },
    error() {
      // Subscription drop is non-fatal: cache + next foreground query cover it.
    },
  });
  return () => sub.unsubscribe();
}
