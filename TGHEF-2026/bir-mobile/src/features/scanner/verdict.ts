/**
 * Gate scan verdict (ARCHITECTURE.md §6 steps 3–5). Pure decision function:
 * signature/time via verifier, then revocation list, zone, and the local
 * (jti, gate) duplicate defense. UI maps the verdict to i18n + green/red.
 */
import type { EcJwk, PassClaims } from '@/offline/verifier';
import { verifyPass } from '@/offline/verifier';

export type ScanVerdict =
  | 'valid'
  | 'expired'
  | 'not-yet-valid'
  | 'revoked'
  | 'wrong-zone'
  | 'duplicate'
  | 'bad-signature'
  | 'malformed';

export interface ScanContext {
  jwks: EcJwk[];
  nowSec: number;
  gateZone: string;
  isRevoked(jti: string): boolean;
  isDuplicate(jti: string): boolean;
}

export interface ScanOutcome {
  verdict: ScanVerdict;
  claims?: PassClaims;
}

export function evaluateScan(token: string, ctx: ScanContext): ScanOutcome {
  const result = verifyPass(token, ctx.jwks, ctx.nowSec);
  if (!result.ok) {
    const verdict: ScanVerdict =
      result.reason === 'expired'
        ? 'expired'
        : result.reason === 'not-yet-valid'
          ? 'not-yet-valid'
          : result.reason === 'malformed'
            ? 'malformed'
            : 'bad-signature'; // bad-alg / bad-kid / bad-signature all read as invalid pass
    return { verdict };
  }

  const { claims } = result;
  if (ctx.isRevoked(claims.jti)) return { verdict: 'revoked', claims };
  if (!claims.zones.includes(ctx.gateZone)) return { verdict: 'wrong-zone', claims };
  if (ctx.isDuplicate(claims.jti)) return { verdict: 'duplicate', claims };
  return { verdict: 'valid', claims };
}

export const VERDICT_I18N_KEY: Record<ScanVerdict, string> = {
  valid: 'scanner.verdictValid',
  expired: 'scanner.verdictExpired',
  'not-yet-valid': 'scanner.verdictNotYetValid',
  revoked: 'scanner.verdictRevoked',
  'wrong-zone': 'scanner.verdictWrongZone',
  duplicate: 'scanner.verdictDuplicate',
  'bad-signature': 'scanner.verdictBadSignature',
  malformed: 'scanner.verdictMalformed',
};
