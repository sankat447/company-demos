/**
 * Staff scanner verdict (Phase 2) — pure so it's unit-testable and forgery-proof.
 * Mirrors the backend /admin/scan: verify the ES256 pass offline (the SAME
 * verifier + pinned JWKS as every gate), reject revoked, then decide the
 * checkpoint. Gate checkpoints grant any valid pass; event checkpoints
 * (`item:<id>`) require the holder to be in the entitlement snapshot.
 */
import { verifyPass, type EcJwk } from '@/offline/verifier';

export type StaffVerdict =
  | 'valid'
  | 'not-entitled'
  | 'revoked'
  | 'expired'
  | 'not-yet-valid'
  | 'bad-signature'
  | 'malformed';

export interface StaffIdentity {
  name: string;
  ageBand: string;
  passId: string;
  sub: string;
}

export interface StaffScanContext {
  jwks: EcJwk[];
  nowSec: number;
  checkpointId: string;
  isRevoked(jti: string): boolean;
  /** sub → is this holder entitled to this event checkpoint? */
  isEntitled(sub: string, checkpointId: string): boolean;
}

export interface StaffScanOutcome {
  verdict: StaffVerdict;
  identity?: StaffIdentity;
  token: string;
  jti?: string;
}

const passIdOf = (jti: string) =>
  'PASS-' +
  String(jti || '')
    .slice(-8)
    .toUpperCase();

export function evaluateStaffScan(token: string, ctx: StaffScanContext): StaffScanOutcome {
  const r = verifyPass(token, ctx.jwks, ctx.nowSec);
  if (!r.ok) {
    const verdict: StaffVerdict =
      r.reason === 'expired'
        ? 'expired'
        : r.reason === 'not-yet-valid'
          ? 'not-yet-valid'
          : r.reason === 'malformed'
            ? 'malformed'
            : 'bad-signature'; // bad-alg / bad-kid / bad-signature
    return { verdict, token };
  }
  const c = r.claims;
  const identity: StaffIdentity = {
    name: c.name || '',
    ageBand: c.ageBand || '',
    passId: passIdOf(c.jti),
    sub: c.sub,
  };
  if (ctx.isRevoked(c.jti)) return { verdict: 'revoked', identity, token, jti: c.jti };
  if (ctx.checkpointId.startsWith('item:') && !ctx.isEntitled(c.sub, ctx.checkpointId)) {
    return { verdict: 'not-entitled', identity, token, jti: c.jti };
  }
  return { verdict: 'valid', identity, token, jti: c.jti };
}
