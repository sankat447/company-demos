/**
 * Safety-officer fly-status control (closes the analysis gap: a safety actor
 * with no way to act). The officer DECLARES the status; the backend fans it
 * out via EventBridge → Pinpoint to every device and drives the refund queue.
 *
 * This is a privileged mutation: the client route is gated on the
 * `safety-officer` role, and the server MUST re-check the role + audit-log
 * the declaration (who/when/prior-state) — see BACKEND_ASKS. The call rides
 * the outbox so a declaration made on a weak signal at Billing still reaches
 * the backend; but it is also attempted immediately for the fastest fan-out.
 */
import type { FlyState } from './flyStatus';
import type { OutboxStore } from '@/offline/outbox';

export interface DeclareInput {
  sub: string;
  state: FlyState;
  reasonEn: string;
  reasonHi: string;
}

export async function declareFlyStatus(
  outbox: OutboxStore,
  input: DeclareInput,
  nowMs: number,
): Promise<void> {
  await outbox.enqueue(
    {
      // singleton aggregate: declarations serialize, latest wins server-side
      aggregate: 'flystatus:declare',
      mutation: 'setFlyStatus',
      variables: {
        state: input.state,
        reasonEn: input.reasonEn,
        reasonHi: input.reasonHi,
        declaredBy: input.sub,
      },
      idempotencyKey: `flystatus:${nowMs}`,
    },
    nowMs,
  );
}
