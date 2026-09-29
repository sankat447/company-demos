import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

import { processScan } from '@/features/scanner/processScan';
import { MemoryScanStore } from '@/features/scanner/scanStore';
import { bytesToB64url, stringToUtf8 } from '@/offline/encoding';
import type { EcJwk, PassClaims } from '@/offline/verifier';
import { MemoryOutboxStore } from '@/offline/outbox';

const key = p256.utils.randomPrivateKey();
const pub = p256.getPublicKey(key, false);
const jwks: EcJwk[] = [
  {
    kty: 'EC',
    crv: 'P-256',
    kid: 'bir-2026-01',
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
  },
];
const NOW_SEC = 1_763_800_000;
const enc = (o: unknown) => bytesToB64url(stringToUtf8(JSON.stringify(o)));
function pass(claims: Partial<PassClaims>): string {
  const full: PassClaims = {
    jti: 'p1',
    typ: 'ticket',
    sub: 'u',
    evt: 'e',
    zones: ['main'],
    nbf: NOW_SEC - 60,
    exp: NOW_SEC + 3600,
    ...claims,
  };
  const h = enc({ alg: 'ES256', kid: 'bir-2026-01' });
  const p = enc(full);
  const s = p256.sign(sha256(stringToUtf8(`${h}.${p}`)), key).toCompactRawBytes();
  return `${h}.${p}.${bytesToB64url(s)}`;
}
const ctx = { jwks, nowSec: NOW_SEC, gateZone: 'main', isRevoked: () => false };

describe('processScan (P4.1 gate pipeline)', () => {
  it('records + queues a valid scan exactly once', async () => {
    const scans = new MemoryScanStore();
    const outbox = new MemoryOutboxStore();
    const deps = { scans, outbox, gate: 'main', deviceId: 'd1' };

    const r1 = await processScan(pass({}), ctx, deps, NOW_SEC * 1000);
    expect(r1).toMatchObject({ verdict: 'valid', recorded: true, jti: 'p1' });
    expect(await outbox.pendingCount()).toBe(1);
    const [head] = await outbox.dueHeads(NOW_SEC * 1000);
    expect(head.mutation).toBe('recordScan');
    expect(head.idempotencyKey).toBe('scan:p1:main');
  });

  it('a re-scan at the same gate is a duplicate — not re-queued', async () => {
    const scans = new MemoryScanStore();
    const outbox = new MemoryOutboxStore();
    const deps = { scans, outbox, gate: 'main', deviceId: 'd1' };
    await processScan(pass({}), ctx, deps, NOW_SEC * 1000);
    const r2 = await processScan(pass({}), ctx, deps, NOW_SEC * 1000 + 5000);
    expect(r2.verdict).toBe('duplicate');
    expect(r2.recorded).toBe(false);
    expect(await outbox.pendingCount()).toBe(1); // still one
    expect(await scans.pendingCount()).toBe(1);
  });

  it('rejected scans (revoked / wrong-zone / expired) are never recorded or queued', async () => {
    const mk = () => ({
      scans: new MemoryScanStore(),
      outbox: new MemoryOutboxStore(),
      gate: 'main',
      deviceId: 'd',
    });
    const revoked = mk();
    expect(
      (
        await processScan(
          pass({ jti: 'x' }),
          { ...ctx, isRevoked: (j) => j === 'x' },
          revoked,
          NOW_SEC * 1000,
        )
      ).verdict,
    ).toBe('revoked');
    expect(await revoked.outbox.pendingCount()).toBe(0);

    const wrong = mk();
    expect(
      (await processScan(pass({ zones: ['landing'] }), ctx, wrong, NOW_SEC * 1000)).verdict,
    ).toBe('wrong-zone');
    expect(await wrong.scans.pendingCount()).toBe(0);

    const exp = mk();
    expect(
      (await processScan(pass({ exp: NOW_SEC - 3600 }), ctx, exp, NOW_SEC * 1000)).verdict,
    ).toBe('expired');
    expect(await exp.outbox.pendingCount()).toBe(0);
  });

  it('cross-gate: the same pass IS valid at a different gate', async () => {
    const scans = new MemoryScanStore();
    const outbox = new MemoryOutboxStore();
    await processScan(
      pass({ zones: ['main', 'landing'] }),
      ctx,
      { scans, outbox, gate: 'main', deviceId: 'd' },
      NOW_SEC * 1000,
    );
    const other = await processScan(
      pass({ zones: ['main', 'landing'] }),
      { ...ctx, gateZone: 'landing' },
      { scans, outbox, gate: 'landing', deviceId: 'd' },
      NOW_SEC * 1000,
    );
    expect(other.verdict).toBe('valid');
    expect(await scans.pendingCount()).toBe(2);
  });
});
