/**
 * Resolves outbox records to GraphQL documents when the outbox drains.
 * Every offline-queued mutation carries its idempotencyKey to the backend so
 * retries and cross-device replays reconcile server-side.
 */
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

export async function dispatchOutboxRecord(record: OutboxRecord): Promise<void> {
  const query = DOCUMENTS[record.mutation];
  if (!query) throw new Error(`no GraphQL document for outbox mutation "${record.mutation}"`);
  await gqlClient().graphql({
    query,
    variables: { input: { ...record.variables, idempotencyKey: record.idempotencyKey } },
  });
}
