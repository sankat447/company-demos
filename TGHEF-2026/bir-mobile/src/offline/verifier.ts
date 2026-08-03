/**
 * Offline ES256 pass verification (ARCHITECTURE.md §6).
 * Pure functions — no I/O, no globals — so gate verdicts are unit-testable
 * and never block on the network. Target: <50 ms median on mid-range Android.
 */
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

import { b64urlToBytes, stringToUtf8, utf8ToString } from './encoding';

export interface EcJwk {
  kty: 'EC';
  crv: 'P-256';
  kid: string;
  x: string;
  y: string;
}

// Full `typ` claim list per ARCHITECTURE.md §6 (CO-001: adds
// volunteer-attendance and seat-entry).
export type PassType =
  'ticket' | 'volunteer' | 'volunteer-attendance' | 'seat-entry' | 'stall' | 'room';

export interface PassClaims {
  jti: string;
  typ: PassType;
  sub: string;
  evt: string;
  zones: string[];
  nbf: number;
  exp: number;
  seat?: string;
}

export type VerifyFailure =
  'malformed' | 'bad-alg' | 'bad-kid' | 'bad-signature' | 'expired' | 'not-yet-valid';

export type VerifyResult = { ok: true; claims: PassClaims } | { ok: false; reason: VerifyFailure };

/** Tolerated clock drift between gate device and issuer (seconds). */
export const CLOCK_SKEW_SEC = 60;

export function verifyPass(token: string, jwks: EcJwk[], nowSec: number): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; kid?: string };
  let claims: PassClaims;
  try {
    header = JSON.parse(utf8ToString(b64urlToBytes(headerB64)));
    claims = JSON.parse(utf8ToString(b64urlToBytes(payloadB64)));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (header.alg !== 'ES256') return { ok: false, reason: 'bad-alg' };
  if (!header.kid) return { ok: false, reason: 'bad-kid' };

  const jwk = jwks.find((k) => k.kid === header.kid && k.kty === 'EC' && k.crv === 'P-256');
  if (!jwk) return { ok: false, reason: 'bad-kid' };

  let signatureOk = false;
  try {
    const x = b64urlToBytes(jwk.x);
    const y = b64urlToBytes(jwk.y);
    if (x.length !== 32 || y.length !== 32) return { ok: false, reason: 'bad-kid' };
    const publicKey = new Uint8Array(65);
    publicKey[0] = 0x04;
    publicKey.set(x, 1);
    publicKey.set(y, 33);

    const signature = b64urlToBytes(sigB64);
    if (signature.length !== 64) return { ok: false, reason: 'bad-signature' };

    const msgHash = sha256(stringToUtf8(`${headerB64}.${payloadB64}`));
    signatureOk = p256.verify(signature, msgHash, publicKey);
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
  if (!signatureOk) return { ok: false, reason: 'bad-signature' };

  if (
    typeof claims.jti !== 'string' ||
    typeof claims.sub !== 'string' ||
    typeof claims.nbf !== 'number' ||
    typeof claims.exp !== 'number' ||
    !Array.isArray(claims.zones)
  ) {
    return { ok: false, reason: 'malformed' };
  }

  if (nowSec + CLOCK_SKEW_SEC < claims.nbf) return { ok: false, reason: 'not-yet-valid' };
  if (nowSec - CLOCK_SKEW_SEC > claims.exp) return { ok: false, reason: 'expired' };

  return { ok: true, claims };
}
