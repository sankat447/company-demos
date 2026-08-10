/**
 * ES256 pass/badge issuer + revocation (ARCHITECTURE §6). Signs the JWTs the
 * app verifies OFFLINE with the pinned JWKS. Called by the payment webhook
 * (ticket passes), the badge mutation (typ:'participant'), and the volunteer
 * certificate job.
 *
 * The private key is read from SSM SecureString / KMS at cold start; the
 * public JWKS is published to the media CDN at `passes.jwksPath`. NEVER embed
 * the private key in code or return it.
 */
import { createSign } from 'node:crypto';

export type PassType =
  | 'ticket'
  | 'volunteer'
  | 'volunteer-attendance'
  | 'seat-entry'
  | 'stall'
  | 'room'
  | 'activity'
  | 'participant';

export interface IssueRequest {
  typ: PassType;
  sub: string;
  evt: string;
  zones: string[];
  nbf: number;
  exp: number;
  seat?: string;
  competition?: string;
}

const KID = process.env.ISSUER_KID ?? 'bir-2026-01';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

async function loadPrivateKeyPem(): Promise<string> {
  // TODO(backend): fetch from SSM SecureString (/bir/passes/privateKeyPem)
  // via @aws-sdk/client-ssm, cached across invocations. Rotate with the kid.
  throw new Error('pass-signer: wire SSM private-key retrieval before deploy');
}

export async function signPass(req: IssueRequest): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: KID }));
  const jti = `${req.typ}-${req.sub}-${req.nbf}`;
  const payload = b64url(JSON.stringify({ jti, ...req }));
  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const der = signer.sign({ key: await loadPrivateKeyPem(), dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(der)}`;
}

/** AppSync Lambda data-source handler. */
export async function handler(event: { field: string; arguments: Record<string, unknown> }) {
  switch (event.field) {
    case 'issueBadge':
      // TODO(backend): look up the confirmed registration, enforce
      // confirmed+lodging-resolved, then signPass({ typ:'participant', ... }).
      throw new Error('issueBadge: not yet implemented');
    case 'revoke':
      // TODO(backend): write { pk: 'REVOCATION', sk: jti } so revocationsDelta
      // ships it to devices within one sync cycle.
      throw new Error('revoke: not yet implemented');
    default:
      throw new Error(`pass-signer: unknown field ${event.field}`);
  }
}
