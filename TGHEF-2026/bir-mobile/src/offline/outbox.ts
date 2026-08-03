/**
 * Outbox engine (P2.2): enqueue(mutation, idempotencyKey), FIFO drain per
 * aggregate, exponential backoff with jitter, poison queue surfaced in the
 * debug screen. The engine is pure over an OutboxStore so it is fully
 * unit-testable; SQLite and in-memory stores implement the interface.
 */

export interface OutboxMutation {
  /** FIFO ordering domain, e.g. "scans:gate-A" or "votes:<userId>". */
  aggregate: string;
  /** GraphQL mutation name — dispatcher resolves it to a document. */
  mutation: string;
  variables: Record<string, unknown>;
  /** Server-side dedupe key; enqueueing the same key twice is a no-op. */
  idempotencyKey: string;
}

export type OutboxStatus = 'pending' | 'poison';

export interface OutboxRecord extends OutboxMutation {
  id: number;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError?: string | null;
}

export interface OutboxStore {
  enqueue(mutation: OutboxMutation, nowMs: number): Promise<void>;
  /** Oldest due pending record per aggregate (the FIFO heads). */
  dueHeads(nowMs: number): Promise<OutboxRecord[]>;
  markDone(id: number): Promise<void>;
  markFailed(id: number, error: string, nextAttemptAt: number, poison: boolean): Promise<void>;
  poisoned(): Promise<OutboxRecord[]>;
  pendingCount(): Promise<number>;
}

export type Dispatch = (record: OutboxRecord) => Promise<void>;

export const BACKOFF = { baseMs: 2_000, capMs: 5 * 60_000, maxAttempts: 8 } as const;

/** Full jitter: delay in [exp/2, exp] where exp = min(cap, base·2^attempts). */
export function backoffDelayMs(attempts: number, rand: () => number = Math.random): number {
  const exp = Math.min(BACKOFF.capMs, BACKOFF.baseMs * 2 ** attempts);
  return Math.floor(exp / 2 + rand() * (exp / 2));
}

export interface DrainStats {
  sent: number;
  failed: number;
  poisoned: number;
}

/**
 * Drain until no head is due. Heads are one-per-aggregate, so a failing
 * aggregate blocks only itself (its head gets a future nextAttemptAt);
 * other aggregates keep flowing.
 */
export async function drainOutbox(
  store: OutboxStore,
  dispatch: Dispatch,
  opts: { nowMs?: () => number; rand?: () => number } = {},
): Promise<DrainStats> {
  const nowMs = opts.nowMs ?? Date.now;
  const stats: DrainStats = { sent: 0, failed: 0, poisoned: 0 };

  for (;;) {
    const heads = await store.dueHeads(nowMs());
    if (heads.length === 0) return stats;

    for (const record of heads) {
      try {
        await dispatch(record);
        await store.markDone(record.id);
        stats.sent += 1;
      } catch (err) {
        const attempts = record.attempts + 1;
        const poison = attempts >= BACKOFF.maxAttempts;
        const message = err instanceof Error ? err.message : String(err);
        await store.markFailed(
          record.id,
          message,
          nowMs() + backoffDelayMs(attempts, opts.rand),
          poison,
        );
        if (poison) stats.poisoned += 1;
        else stats.failed += 1;
      }
    }
  }
}

/** In-memory store — unit tests and the on-device debug screen preview. */
export class MemoryOutboxStore implements OutboxStore {
  private records: OutboxRecord[] = [];
  private nextId = 1;

  async enqueue(mutation: OutboxMutation, nowMs: number): Promise<void> {
    if (this.records.some((r) => r.idempotencyKey === mutation.idempotencyKey)) return;
    this.records.push({
      ...mutation,
      id: this.nextId++,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: nowMs,
      lastError: null,
    });
  }

  async dueHeads(nowMs: number): Promise<OutboxRecord[]> {
    const heads = new Map<string, OutboxRecord>();
    for (const r of this.records) {
      if (r.status !== 'pending') continue;
      const head = heads.get(r.aggregate);
      if (!head || r.id < head.id) heads.set(r.aggregate, r);
    }
    return [...heads.values()].filter((r) => r.nextAttemptAt <= nowMs).sort((a, b) => a.id - b.id);
  }

  async markDone(id: number): Promise<void> {
    this.records = this.records.filter((r) => r.id !== id);
  }

  async markFailed(
    id: number,
    error: string,
    nextAttemptAt: number,
    poison: boolean,
  ): Promise<void> {
    const r = this.records.find((rec) => rec.id === id);
    if (!r) return;
    r.attempts += 1;
    r.lastError = error;
    r.nextAttemptAt = nextAttemptAt;
    if (poison) r.status = 'poison';
  }

  async poisoned(): Promise<OutboxRecord[]> {
    return this.records.filter((r) => r.status === 'poison');
  }

  async pendingCount(): Promise<number> {
    return this.records.filter((r) => r.status === 'pending').length;
  }
}
