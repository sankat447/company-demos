/**
 * P3.1 purchase engine. The invariant (ARCHITECTURE.md §5): payment success is
 * asserted ONLY by the backend webhook → onOrderConfirmed subscription — never
 * by the provider's client callback. The checkout SDK result merely tells us
 * whether the user finished the sheet; the pass exists when the subscription
 * (or the getOrder recovery query) delivers signed pass tokens, which we
 * verify against the JWKS before storing.
 */
import {
  gqlClient,
  gqlSubscribe,
  GET_ORDER,
  ON_ORDER_CONFIRMED,
  TICKET_TIERS,
} from '@/api/graphql';
import type { GqlOperation, GqlSubscription } from '@/api/graphql';
import type { KvStore } from '@/offline/jwks';
import type { EcJwk, PassClaims } from '@/offline/verifier';
import { verifyPass } from '@/offline/verifier';

import { savePass } from './passStore';

export interface TicketTier {
  id: string;
  titleEn: string;
  titleHi?: string | null;
  priceInr: number;
  description?: string | null;
}

export async function fetchTicketTiers(): Promise<TicketTier[]> {
  const res = (await gqlClient().graphql({ query: TICKET_TIERS })) as {
    data?: { ticketTiers?: { items: TicketTier[] } };
  };
  return res.data?.ticketTiers?.items ?? [];
}

export interface ConfirmedOrder {
  orderId: string;
  status: string;
  passTokens: string[];
}

export const CONFIRMATION_TIMEOUT_MS = 120_000;

/**
 * Resolve when the backend webhook confirms the order. Subscription-first
 * (polling is forbidden where a subscription exists); the caller races this
 * against nothing — a timeout here just means "keep the order pending",
 * recovery picks it up on next launch.
 */
export function awaitOrderConfirmation(
  orderId: string,
  opts: {
    timeoutMs?: number;
    subscribe?: (op: GqlOperation) => GqlSubscription;
  } = {},
): Promise<ConfirmedOrder> {
  const subscribe = opts.subscribe ?? gqlSubscribe;
  const timeoutMs = opts.timeoutMs ?? CONFIRMATION_TIMEOUT_MS;

  return new Promise<ConfirmedOrder>((resolve, reject) => {
    const sub = subscribe({ query: ON_ORDER_CONFIRMED, variables: { orderId } }).subscribe({
      next(value) {
        const confirmed = (value as { data?: { onOrderConfirmed?: ConfirmedOrder } }).data
          ?.onOrderConfirmed;
        if (!confirmed) return;
        cleanup();
        resolve(confirmed);
      },
      error(err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('order-confirmation-timeout'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      sub.unsubscribe();
    }
  });
}

/**
 * Verify webhook-delivered pass tokens against the cached JWKS and store the
 * good ones. Any invalid token aborts the whole batch — a pass that fails
 * signature/time checks must never enter the wallet.
 */
export async function ingestPassTokens(
  tokens: string[],
  jwks: EcJwk[],
  nowSec: number,
  save: (token: string, claims: PassClaims, nowMs: number) => Promise<void> = savePass,
): Promise<PassClaims[]> {
  const verified: { token: string; claims: PassClaims }[] = [];
  for (const token of tokens) {
    const result = verifyPass(token, jwks, nowSec);
    if (!result.ok) throw new Error(`pass token rejected: ${result.reason}`);
    verified.push({ token, claims: result.claims });
  }
  for (const { token, claims } of verified) {
    await save(token, claims, nowSec * 1000);
  }
  return verified.map((v) => v.claims);
}

// --- pending-order persistence (kill-app-between-pay-and-confirm recovery) ---

const PENDING_KEY = 'orders.pending';

interface PendingOrder {
  orderId: string;
  createdAtMs: number;
}

export async function listPendingOrders(kv: KvStore): Promise<PendingOrder[]> {
  const rawValue = await kv.get(PENDING_KEY);
  if (!rawValue) return [];
  try {
    return JSON.parse(rawValue) as PendingOrder[];
  } catch {
    return [];
  }
}

export async function rememberPendingOrder(
  kv: KvStore,
  orderId: string,
  nowMs: number,
): Promise<void> {
  const pending = await listPendingOrders(kv);
  if (!pending.some((p) => p.orderId === orderId)) {
    pending.push({ orderId, createdAtMs: nowMs });
  }
  await kv.set(PENDING_KEY, JSON.stringify(pending));
}

export async function clearPendingOrder(kv: KvStore, orderId: string): Promise<void> {
  const pending = await listPendingOrders(kv);
  await kv.set(PENDING_KEY, JSON.stringify(pending.filter((p) => p.orderId !== orderId)));
}

/**
 * On launch/foreground: for each order left pending, ask the backend for its
 * current state (getOrder — the subscription can't replay events fired while
 * the app was dead). Confirmed → ingest passes + clear; failed/expired →
 * clear; still pending → leave for the next pass.
 */
export async function resumePendingOrders(
  kv: KvStore,
  jwks: EcJwk[],
  nowSec: number,
  deps: {
    getOrder?: (orderId: string) => Promise<ConfirmedOrder | null>;
    save?: (token: string, claims: PassClaims, nowMs: number) => Promise<void>;
  } = {},
): Promise<number> {
  const getOrder = deps.getOrder ?? fetchOrder;
  let ingested = 0;
  for (const pending of await listPendingOrders(kv)) {
    const order = await getOrder(pending.orderId);
    if (!order) continue;
    if (order.status === 'CONFIRMED') {
      await ingestPassTokens(order.passTokens, jwks, nowSec, deps.save);
      await clearPendingOrder(kv, pending.orderId);
      ingested += order.passTokens.length;
    } else if (order.status === 'FAILED' || order.status === 'EXPIRED') {
      await clearPendingOrder(kv, pending.orderId);
    }
  }
  return ingested;
}

async function fetchOrder(orderId: string): Promise<ConfirmedOrder | null> {
  const res = (await gqlClient().graphql({ query: GET_ORDER, variables: { orderId } })) as {
    data?: { getOrder?: ConfirmedOrder | null };
  };
  return res.data?.getOrder ?? null;
}
