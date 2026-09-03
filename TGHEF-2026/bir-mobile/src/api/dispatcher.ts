/**
 * Resolves outbox records to GraphQL documents when the outbox drains, and
 * reconciles the server's response back into local state. Every offline-queued
 * mutation carries its idempotencyKey so retries and cross-device replays
 * reconcile server-side; the reconcile step here folds the authoritative
 * response (a registration's confirmed/waitlisted status + refund state, a
 * commit's server verdict) into the kv the screens read — the outbox is no
 * longer fire-and-forget.
 */
import { saveCommitResult } from '@/features/lodging/allocation';
import {
  kvRegistrationStore,
  mapServerRegistrationStatus,
  markRegistration,
  normaliseRefundState,
} from '@/features/highlights/registration';
import { kvStore } from '@/offline/db';
import type { OutboxRecord } from '@/offline/outbox';

import {
  CANCEL_REGISTRATION,
  COMMIT_ALLOCATION,
  RECORD_ATTENDANCE,
  RETIRE_ROOM,
  SAVE_ROOM,
  SET_FLY_STATUS,
  REPORT_INCIDENT,
  CAST_VOTE,
  CREATE_REGISTRATION,
  gqlClient,
  RECORD_SCAN,
  REGISTER_DEVICE,
  REPORT_SOS,
} from './graphql';

const DOCUMENTS: Record<string, string> = {
  cancelRegistration: CANCEL_REGISTRATION,
  commitAllocation: COMMIT_ALLOCATION,
  recordAttendance: RECORD_ATTENDANCE,
  saveRoom: SAVE_ROOM,
  retireRoom: RETIRE_ROOM,
  setFlyStatus: SET_FLY_STATUS,
  reportIncident: REPORT_INCIDENT,
  castVote: CAST_VOTE,
  createRegistration: CREATE_REGISTRATION,
  recordScan: RECORD_SCAN,
  registerDevice: REGISTER_DEVICE,
  reportSos: REPORT_SOS,
};

/**
 * Fold a drained mutation's response into local state. Best-effort: the caller
 * MUST swallow any throw here so a reconcile failure never re-sends the (already
 * committed) mutation.
 */
async function reconcile(record: OutboxRecord, data: Record<string, unknown> | undefined) {
  if (!data) return;
  switch (record.mutation) {
    case 'createRegistration': {
      const ack = data.createRegistration as { status?: string } | undefined;
      const status = mapServerRegistrationStatus(ack?.status);
      // record.idempotencyKey is the local registration id (reg:sub:item:slot).
      if (status)
        await markRegistration(kvRegistrationStore(kvStore), record.idempotencyKey, status);
      break;
    }
    case 'cancelRegistration': {
      const ack = data.cancelRegistration as { refundState?: string | null } | undefined;
      const registrationId = record.variables.registrationId as string;
      await markRegistration(kvRegistrationStore(kvStore), registrationId, 'cancelled', {
        refundState: normaliseRefundState(ack?.refundState),
      });
      break;
    }
    case 'commitAllocation': {
      const r = data.commitAllocation as
        { version?: number; accepted?: boolean; violations?: string[] } | undefined;
      if (r) {
        await saveCommitResult(kvStore, {
          version: r.version ?? (record.variables.version as number),
          accepted: r.accepted ?? true,
          violations: r.violations ?? [],
          atMs: record.createdAt,
        });
      }
      break;
    }
    default:
      break; // room writes etc. already applied optimistically
  }
}

export async function dispatchOutboxRecord(record: OutboxRecord): Promise<void> {
  const query = DOCUMENTS[record.mutation];
  if (!query) throw new Error(`no GraphQL document for outbox mutation "${record.mutation}"`);
  const res = (await gqlClient().graphql({
    query,
    variables: { input: { ...record.variables, idempotencyKey: record.idempotencyKey } },
  })) as { data?: Record<string, unknown> };
  try {
    await reconcile(record, res.data);
  } catch {
    // Reconcile is best-effort — the mutation already succeeded. Never rethrow,
    // or the drain would mark the record failed and re-send it.
  }
}
