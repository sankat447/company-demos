/**
 * Auto-drain: whenever connectivity returns, push queued mutations (votes,
 * scans, …) through the dispatcher. FIFO-per-aggregate and backoff live in
 * the engine (outbox.ts); this is just the trigger.
 */
import NetInfo from '@react-native-community/netinfo';

import { dispatchOutboxRecord } from '@/api/dispatcher';

import { drainOutbox } from './outbox';
import { SqliteOutboxStore } from './sqliteOutboxStore';

let started = false;
let draining = false;

export function startOutboxAutoDrain(): void {
  if (started) return;
  started = true;
  const store = new SqliteOutboxStore();

  const run = () => {
    if (draining) return;
    draining = true;
    void drainOutbox(store, dispatchOutboxRecord)
      .catch(() => {
        // Failures already recorded per-record with backoff; next trigger retries.
      })
      .finally(() => {
        draining = false;
      });
  };

  NetInfo.addEventListener((state) => {
    if (state.isConnected) run();
  });
  run();
}
