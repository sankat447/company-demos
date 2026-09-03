/**
 * B2d: backend participant-badge issuance. Calls the admin-guarded issueBadge
 * mutation, then verifies the returned ES256 pass against the JWKS and stores it
 * in the offline wallet — the same ingestion path as ticket passes. Kept out of
 * the pure badges.ts so unit tests there stay Amplify-free.
 */
import { gqlClient, ISSUE_BADGE } from '@/api/graphql';
import { ingestPassTokens } from '@/features/tickets/purchase';
import { kvStore } from '@/offline/db';
import { ensureFreshJwks } from '@/offline/jwks';

export async function issueParticipantBadge(regId: string): Promise<string | null> {
  const res = (await gqlClient().graphql({
    query: ISSUE_BADGE,
    variables: { input: { regId, idempotencyKey: `badge:${regId}` } },
  })) as { data?: { issueBadge?: { jti: string; passToken: string } } };
  const issued = res.data?.issueBadge;
  if (!issued?.passToken) return null;
  const jwks = await ensureFreshJwks(kvStore, Date.now());
  const claims = await ingestPassTokens([issued.passToken], jwks, Math.floor(Date.now() / 1000));
  return claims[0]?.jti ?? issued.jti;
}
