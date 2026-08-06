import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

import type { GqlOperation, GqlSubscription } from '@/api/graphql';

// Every function under test takes injected deps (subscribe/getOrder/save);
// the real module is only imported for defaults, and loading it drags in
// Amplify's native-module chain — stub it to keep this suite hermetic.
jest.mock('@/api/graphql', () => ({
  gqlClient: jest.fn(),
  gqlSubscribe: jest.fn(),
  GET_ORDER: 'GetOrder',
  ON_ORDER_CONFIRMED: 'OnOrderConfirmed',
  TICKET_TIERS: 'TicketTiers',
}));
// Same reason: passStore drags in expo-sqlite; tests always inject `save`.
jest.mock('@/features/tickets/passStore', () => ({
  savePass: jest.fn(),
}));
import {
  awaitOrderConfirmation,
  clearPendingOrder,
  ingestPassTokens,
  listPendingOrders,
  rememberPendingOrder,
  resumePendingOrders,
  type ConfirmedOrder,
} from '@/features/tickets/purchase';
import { stringToUtf8 } from '@/offline/encoding';
import type { KvStore } from '@/offline/jwks';
import type { EcJwk, PassClaims } from '@/offline/verifier';

// --- helpers: sign test passes (same scheme as verifier.test.ts) ---
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function bytesToB64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}
const enc = (obj: unknown) => bytesToB64url(stringToUtf8(JSON.stringify(obj)));

const NOW = 1_763_700_000;
const privKey = p256.utils.randomPrivateKey();
const pubKey = p256.getPublicKey(privKey, false);
const jwk: EcJwk = {
  kty: 'EC',
  crv: 'P-256',
  kid: 'bir-2026-01',
  x: bytesToB64url(pubKey.slice(1, 33)),
  y: bytesToB64url(pubKey.slice(33, 65)),
};

function signPass(jti: string): string {
  const claims: PassClaims = {
    jti,
    typ: 'ticket',
    sub: 'user-1',
    evt: 'bir-festival-2026',
    zones: ['main'],
    nbf: NOW - 3600,
    exp: NOW + 3600,
  };
  const header = enc({ alg: 'ES256', kid: jwk.kid });
  const payload = enc(claims);
  const sig = p256.sign(sha256(stringToUtf8(`${header}.${payload}`)), privKey).toCompactRawBytes();
  return `${header}.${payload}.${bytesToB64url(sig)}`;
}

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

describe('ingestPassTokens', () => {
  it('verifies and stores every token from a confirmed order', async () => {
    const saved: PassClaims[] = [];
    const claims = await ingestPassTokens(
      [signPass('p1'), signPass('p2')],
      [jwk],
      NOW,
      async (_token, c) => {
        saved.push(c);
      },
    );
    expect(claims.map((c) => c.jti)).toEqual(['p1', 'p2']);
    expect(saved).toHaveLength(2);
  });

  it('rejects the whole batch when any token fails verification — nothing stored', async () => {
    const saved: PassClaims[] = [];
    const forged = signPass('good') + 'x'; // corrupt signature
    await expect(
      ingestPassTokens([signPass('p1'), forged], [jwk], NOW, async (_t, c) => {
        saved.push(c);
      }),
    ).rejects.toThrow('pass token rejected');
    expect(saved).toHaveLength(0);
  });
});

describe('awaitOrderConfirmation', () => {
  function fakeSubscription(
    emit: (next: (v: unknown) => void, error: (e: unknown) => void) => void,
  ) {
    let unsubscribed = false;
    const sub = (_op: GqlOperation): GqlSubscription => ({
      subscribe(handlers) {
        emit(handlers.next, handlers.error);
        return {
          unsubscribe() {
            unsubscribed = true;
          },
        };
      },
    });
    return { sub, wasUnsubscribed: () => unsubscribed };
  }

  it('resolves on the webhook-driven confirmation event', async () => {
    const { sub, wasUnsubscribed } = fakeSubscription((next) => {
      setTimeout(
        () =>
          next({
            data: {
              onOrderConfirmed: { orderId: 'o1', status: 'CONFIRMED', passTokens: ['tok'] },
            },
          }),
        5,
      );
    });
    const confirmed = await awaitOrderConfirmation('o1', { subscribe: sub, timeoutMs: 1000 });
    expect(confirmed.status).toBe('CONFIRMED');
    expect(wasUnsubscribed()).toBe(true);
  });

  it('rejects on subscription error and on timeout', async () => {
    const { sub } = fakeSubscription((_next, error) => {
      setTimeout(() => error(new Error('socket dropped')), 5);
    });
    await expect(awaitOrderConfirmation('o1', { subscribe: sub, timeoutMs: 1000 })).rejects.toThrow(
      'socket dropped',
    );

    const silent = fakeSubscription(() => {});
    await expect(
      awaitOrderConfirmation('o2', { subscribe: silent.sub, timeoutMs: 20 }),
    ).rejects.toThrow('order-confirmation-timeout');
    expect(silent.wasUnsubscribed()).toBe(true);
  });
});

describe('pending-order recovery (kill app between pay and confirm)', () => {
  it('remember/list/clear round-trip is idempotent', async () => {
    const kv = memoryKv();
    await rememberPendingOrder(kv, 'o1', 1000);
    await rememberPendingOrder(kv, 'o1', 2000); // duplicate ignored
    await rememberPendingOrder(kv, 'o2', 3000);
    expect((await listPendingOrders(kv)).map((p) => p.orderId)).toEqual(['o1', 'o2']);
    await clearPendingOrder(kv, 'o1');
    expect((await listPendingOrders(kv)).map((p) => p.orderId)).toEqual(['o2']);
  });

  it('resume ingests confirmed orders, drops failed ones, keeps pending ones', async () => {
    const kv = memoryKv();
    await rememberPendingOrder(kv, 'confirmed', 1);
    await rememberPendingOrder(kv, 'failed', 2);
    await rememberPendingOrder(kv, 'still-pending', 3);

    const orders: Record<string, ConfirmedOrder> = {
      confirmed: { orderId: 'confirmed', status: 'CONFIRMED', passTokens: [signPass('p9')] },
      failed: { orderId: 'failed', status: 'FAILED', passTokens: [] },
      'still-pending': { orderId: 'still-pending', status: 'PENDING', passTokens: [] },
    };
    const saved: PassClaims[] = [];

    const ingested = await resumePendingOrders(kv, [jwk], NOW, {
      getOrder: async (id) => orders[id] ?? null,
      save: async (_t, c) => {
        saved.push(c);
      },
    });

    expect(ingested).toBe(1);
    expect(saved.map((c) => c.jti)).toEqual(['p9']);
    expect((await listPendingOrders(kv)).map((p) => p.orderId)).toEqual(['still-pending']);
  });
});
