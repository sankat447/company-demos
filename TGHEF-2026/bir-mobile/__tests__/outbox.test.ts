import {
  BACKOFF,
  backoffDelayMs,
  drainOutbox,
  MemoryOutboxStore,
  type OutboxRecord,
} from '@/offline/outbox';

const T0 = 1_700_000_000_000;

function mutation(n: number, aggregate = 'scans:gate-A') {
  return {
    aggregate,
    mutation: 'recordScan',
    variables: { n },
    idempotencyKey: `${aggregate}:${n}`,
  };
}

describe('outbox engine', () => {
  it('enqueue is idempotent on idempotencyKey', async () => {
    const store = new MemoryOutboxStore();
    await store.enqueue(mutation(1), T0);
    await store.enqueue(mutation(1), T0 + 5);
    expect(await store.pendingCount()).toBe(1);
  });

  it('drains FIFO within an aggregate', async () => {
    const store = new MemoryOutboxStore();
    for (const n of [1, 2, 3]) await store.enqueue(mutation(n), T0 + n);
    const sent: number[] = [];
    await drainOutbox(store, async (r: OutboxRecord) => {
      sent.push(r.variables.n as number);
    });
    expect(sent).toEqual([1, 2, 3]);
    expect(await store.pendingCount()).toBe(0);
  });

  it('a failing aggregate blocks only itself', async () => {
    const store = new MemoryOutboxStore();
    await store.enqueue(mutation(1, 'scans:gate-A'), T0);
    await store.enqueue(mutation(2, 'scans:gate-A'), T0 + 1);
    await store.enqueue(mutation(3, 'votes:u1'), T0 + 2);

    const sent: string[] = [];
    const stats = await drainOutbox(
      store,
      async (r) => {
        if (r.aggregate === 'scans:gate-A') throw new Error('gate offline');
        sent.push(r.idempotencyKey);
      },
      { nowMs: () => T0 + 10 },
    );

    expect(sent).toEqual(['votes:u1:3']);
    expect(stats.sent).toBe(1);
    expect(stats.failed).toBe(1);
    // gate-A head deferred with backoff; #2 still queued behind it
    expect(await store.pendingCount()).toBe(2);
  });

  it('poisons after maxAttempts and surfaces in poisoned()', async () => {
    const store = new MemoryOutboxStore();
    await store.enqueue(mutation(1), T0);

    let clock = T0;
    for (let round = 0; round < BACKOFF.maxAttempts; round++) {
      await drainOutbox(store, async () => Promise.reject(new Error('boom')), {
        nowMs: () => clock,
      });
      clock += BACKOFF.capMs + 1; // jump past any backoff
    }

    const poisoned = await store.poisoned();
    expect(poisoned).toHaveLength(1);
    expect(poisoned[0].attempts).toBe(BACKOFF.maxAttempts);
    expect(poisoned[0].lastError).toBe('boom');
    expect(await store.pendingCount()).toBe(0);
  });

  it('backoff grows exponentially with jitter and caps', () => {
    const noJitter = () => 0; // lower bound: exp/2
    expect(backoffDelayMs(0, noJitter)).toBe(BACKOFF.baseMs / 2);
    expect(backoffDelayMs(1, noJitter)).toBe(BACKOFF.baseMs);
    expect(backoffDelayMs(20, noJitter)).toBe(BACKOFF.capMs / 2);
    const fullJitter = () => 1;
    expect(backoffDelayMs(20, fullJitter)).toBe(BACKOFF.capMs);
  });
});
