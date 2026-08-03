import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

import { stringToUtf8 } from '@/offline/encoding';
import type { EcJwk, PassClaims } from '@/offline/verifier';
import { CLOCK_SKEW_SEC, verifyPass } from '@/offline/verifier';
import { evaluateScan } from '@/features/scanner/verdict';

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

const NOW = 1_763_700_000; // during festival week, seconds
const KID = 'bir-2026-01';

const privKey = p256.utils.randomPrivateKey();
const pubKey = p256.getPublicKey(privKey, false); // uncompressed 65 bytes

const jwk: EcJwk = {
  kty: 'EC',
  crv: 'P-256',
  kid: KID,
  x: bytesToB64url(pubKey.slice(1, 33)),
  y: bytesToB64url(pubKey.slice(33, 65)),
};

function signPass(claims: Partial<PassClaims>, kid = KID): string {
  const full: PassClaims = {
    jti: 'pass-1',
    typ: 'ticket',
    sub: 'user-1',
    evt: 'bir-festival-2026',
    zones: ['main', 'landing'],
    nbf: NOW - 3600,
    exp: NOW + 3600,
    ...claims,
  };
  const header = enc({ alg: 'ES256', kid });
  const payload = enc(full);
  const msgHash = sha256(stringToUtf8(`${header}.${payload}`));
  const sig = p256.sign(msgHash, privKey).toCompactRawBytes();
  return `${header}.${payload}.${bytesToB64url(sig)}`;
}

describe('verifyPass (offline ES256)', () => {
  it('accepts a valid pass', () => {
    const result = verifyPass(signPass({}), [jwk], NOW);
    expect(result).toMatchObject({ ok: true, claims: { jti: 'pass-1', typ: 'ticket' } });
  });

  it('rejects an expired pass', () => {
    const result = verifyPass(signPass({ exp: NOW - CLOCK_SKEW_SEC - 10 }), [jwk], NOW);
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a pass used before nbf', () => {
    const result = verifyPass(signPass({ nbf: NOW + CLOCK_SKEW_SEC + 10 }), [jwk], NOW);
    expect(result).toEqual({ ok: false, reason: 'not-yet-valid' });
  });

  it('tolerates clock skew inside the window', () => {
    expect(verifyPass(signPass({ exp: NOW - 30 }), [jwk], NOW).ok).toBe(true);
    expect(verifyPass(signPass({ nbf: NOW + 30 }), [jwk], NOW).ok).toBe(true);
  });

  it('rejects an unknown kid', () => {
    const result = verifyPass(signPass({}, 'rogue-kid'), [jwk], NOW);
    expect(result).toEqual({ ok: false, reason: 'bad-kid' });
  });

  it('rejects a tampered payload', () => {
    const token = signPass({});
    const [h, , s] = token.split('.');
    const forged = `${h}.${enc({ jti: 'pass-1', typ: 'ticket', sub: 'attacker', evt: 'x', zones: ['main'], nbf: NOW - 1, exp: NOW + 1 })}.${s}`;
    expect(verifyPass(forged, [jwk], NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects garbage input as malformed', () => {
    expect(verifyPass('not-a-jwt', [jwk], NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyPass('a.b.c', [jwk], NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('median verify time is fast enough for the gate (<50 ms budget)', () => {
    const token = signPass({});
    const times: number[] = [];
    for (let i = 0; i < 21; i++) {
      const start = performance.now();
      verifyPass(token, [jwk], NOW);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[10]).toBeLessThan(50);
  });
});

describe('evaluateScan (gate verdict)', () => {
  const baseCtx = {
    jwks: [jwk],
    nowSec: NOW,
    gateZone: 'main',
    isRevoked: () => false,
    isDuplicate: () => false,
  };

  it('valid pass at the right gate', () => {
    expect(evaluateScan(signPass({}), baseCtx).verdict).toBe('valid');
  });

  it('revoked jti from the cached revocation list', () => {
    const ctx = { ...baseCtx, isRevoked: (jti: string) => jti === 'pass-1' };
    expect(evaluateScan(signPass({}), ctx).verdict).toBe('revoked');
  });

  it('wrong zone for this gate', () => {
    const ctx = { ...baseCtx, gateZone: 'vip' };
    expect(evaluateScan(signPass({}), ctx).verdict).toBe('wrong-zone');
  });

  it('duplicate (jti, gate) blocked locally', () => {
    const ctx = { ...baseCtx, isDuplicate: () => true };
    expect(evaluateScan(signPass({}), ctx).verdict).toBe('duplicate');
  });
});
