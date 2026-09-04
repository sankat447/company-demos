/**
 * Revoke a pass/badge (B6) — a safety-officer / organiser-lite action from the
 * ops screen. The backend writes a REVOCATION row that the `revocationsDelta`
 * feed serves to every device, so the offline verifier (see verdict.ts /
 * loadRevokedSet) rejects the pass on its next sync — even with no signal at the
 * gate. The call rides the outbox so a revocation declared on a weak signal at
 * Billing still reaches the backend; the server re-checks the role.
 *
 * Idempotent per jti: the idempotencyKey IS `revoke:<jti>`, so re-declaring the
 * same jti (or a re-drained queue entry) upserts the same REVOCATION row.
 */
import type { OutboxStore } from '@/offline/outbox';

export async function queueRevokePass(
  outbox: OutboxStore,
  jti: string,
  nowMs: number,
): Promise<void> {
  await outbox.enqueue(
    {
      aggregate: `revoke:${jti}`,
      mutation: 'revokePass',
      variables: { jti },
      idempotencyKey: `revoke:${jti}`,
    },
    nowMs,
  );
}
