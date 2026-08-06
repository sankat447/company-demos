import {
  DEMO_OTP,
  demoSchedule,
  disableDemoSession,
  enableDemoSession,
  isDemoSession,
  tryDemoOtp,
  type DemoScheduleRow,
  type DemoSeedDeps,
} from '@/demo/demo';
import type { EcJwk, PassClaims } from '@/offline/verifier';
import { verifyPass } from '@/offline/verifier';
import type { KvStore } from '@/offline/jwks';

// demo.ts is pure over injected deps; nothing native to stub.

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

function fakeDeps() {
  const kv = memoryKv();
  const jwks: EcJwk[] = [];
  const passes: { token: string; claims: PassClaims }[] = [];
  const rows: DemoScheduleRow[] = [];
  const deps: DemoSeedDeps = {
    kv,
    async primeJwks(_kv, keys) {
      jwks.push(...keys);
    },
    async savePass(token, claims) {
      passes.push({ token, claims });
    },
    async insertScheduleRow(row) {
      rows.push(row);
    },
  };
  return { deps, kv, jwks, passes, rows };
}

const NOW_MS = 1_763_700_000_000;

describe('demo mode', () => {
  it('only the demo OTP opens a session', async () => {
    const { deps, kv } = fakeDeps();
    expect(await tryDemoOtp(deps, '000000', NOW_MS)).toBe(false);
    expect(await isDemoSession(kv)).toBe(false);

    expect(await tryDemoOtp(deps, DEMO_OTP, NOW_MS)).toBe(true);
    expect(await isDemoSession(kv)).toBe(true);

    await disableDemoSession(kv);
    expect(await isDemoSession(kv)).toBe(false);
  });

  it('seeds passes that verify through the REAL ES256 verifier', async () => {
    const { deps, jwks, passes } = fakeDeps();
    await enableDemoSession(deps, NOW_MS);

    expect(jwks).toHaveLength(1);
    expect(jwks[0].kid).toBe('bir-2026-01'); // pinned issuer kid
    expect(passes.length).toBeGreaterThanOrEqual(2);

    for (const pass of passes) {
      const result = verifyPass(pass.token, jwks, Math.floor(NOW_MS / 1000));
      expect(result.ok).toBe(true);
    }
    expect(passes.map((p) => p.claims.typ).sort()).toEqual(['seat-entry', 'ticket']);
  });

  it('seeds a 3-evening programme with votable events, idempotently', async () => {
    const { deps, rows, kv } = fakeDeps();
    const first = await enableDemoSession(deps, NOW_MS);
    const second = await enableDemoSession(deps, NOW_MS + 10);

    expect(first).toBe(true);
    expect(second).toBe(false); // no double-seed
    expect(new Set(rows.map((r) => r.day))).toEqual(
      new Set(['2026-11-21', '2026-11-22', '2026-11-23']),
    );
    expect(rows.some((r) => r.dataJson?.includes('"votable":true'))).toBe(true);
    expect(await kv.get('flystatus.cache')).toContain('"state":"flying"');
    expect(await kv.get('venues.cache')).toContain('Chogan');
  });

  it('schedule fixture is internally consistent (ends after starts, hi parity)', () => {
    for (const row of demoSchedule()) {
      expect(row.endsAtSec).toBeGreaterThan(row.startsAtSec);
      expect(row.titleHi.trim()).not.toBe('');
    }
  });
});
