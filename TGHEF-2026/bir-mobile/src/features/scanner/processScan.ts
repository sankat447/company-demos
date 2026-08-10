/**
 * The scan pipeline (P4.1): decode → evaluate (offline, <1 s) → record valid
 * scans locally → queue the reconciliation mutation. Pure over injected
 * stores so the whole flow is testable; the camera screen supplies the token.
 *
 * A valid scan is recorded AND queued exactly once per (jti, gate); a repeat
 * returns the `duplicate` verdict without re-queueing. Rejected scans are not
 * queued (nothing to reconcile) but the verdict is surfaced to the operator.
 */
import type { OutboxStore } from '@/offline/outbox';

import type { ScanStore } from './scanStore';
import { evaluateScan, type ScanContext, type ScanVerdict } from './verdict';

export interface ProcessScanDeps {
  scans: ScanStore;
  outbox: OutboxStore;
  gate: string;
  deviceId: string;
}

export interface ProcessScanResult {
  verdict: ScanVerdict;
  recorded: boolean;
  jti?: string;
}

export async function processScan(
  token: string,
  ctx: Omit<ScanContext, 'isDuplicate'>,
  deps: ProcessScanDeps,
  nowMs: number,
): Promise<ProcessScanResult> {
  // Let evaluateScan handle signature/time/revocation/zone; the duplicate
  // gate is decided here against the local scan log for this gate.
  const outcome = evaluateScan(token, { ...ctx, isDuplicate: () => false });

  if (outcome.verdict === 'valid' && outcome.claims) {
    if (await deps.scans.isDuplicate(outcome.claims.jti, deps.gate)) {
      return { verdict: 'duplicate', recorded: false, jti: outcome.claims.jti };
    }
    await deps.scans.record({
      jti: outcome.claims.jti,
      gate: deps.gate,
      ts: Math.floor(nowMs / 1000),
      deviceId: deps.deviceId,
      verdict: 'valid',
    });
    await deps.outbox.enqueue(
      {
        aggregate: `scans:${deps.gate}`,
        mutation: 'recordScan',
        variables: { jti: outcome.claims.jti, gate: deps.gate, ts: Math.floor(nowMs / 1000) },
        idempotencyKey: `scan:${outcome.claims.jti}:${deps.gate}`,
      },
      nowMs,
    );
    return { verdict: 'valid', recorded: true, jti: outcome.claims.jti };
  }

  return { verdict: outcome.verdict, recorded: false, jti: outcome.claims?.jti };
}
