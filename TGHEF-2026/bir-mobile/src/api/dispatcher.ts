/**
 * Resolves outbox records to GraphQL documents when the outbox drains.
 * Every offline-queued mutation carries its idempotencyKey to the backend so
 * retries and cross-device replays reconcile server-side.
 */
import type { OutboxRecord } from '@/offline/outbox';

import {
  CAST_VOTE,
  CREATE_REGISTRATION,
  gqlClient,
  RECORD_SCAN,
  REGISTER_DEVICE,
  REPORT_SOS,
} from './graphql';

const DOCUMENTS: Record<string, string> = {
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
