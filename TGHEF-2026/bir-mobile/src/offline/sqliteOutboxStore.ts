import { getDb } from './db';
import type { OutboxMutation, OutboxRecord, OutboxStore } from './outbox';

interface Row {
  id: number;
  aggregate: string;
  mutation: string;
  variables_json: string;
  idempotency_key: string;
  status: 'pending' | 'poison';
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  created_at: number;
}

function toRecord(row: Row): OutboxRecord {
  return {
    id: row.id,
    aggregate: row.aggregate,
    mutation: row.mutation,
    variables: JSON.parse(row.variables_json) as Record<string, unknown>,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    lastError: row.last_error,
  };
}

export class SqliteOutboxStore implements OutboxStore {
  async enqueue(mutation: OutboxMutation, nowMs: number): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO outbox (aggregate, mutation, variables_json, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
      [
        mutation.aggregate,
        mutation.mutation,
        JSON.stringify(mutation.variables),
        mutation.idempotencyKey,
        nowMs,
      ],
    );
  }

  async dueHeads(nowMs: number): Promise<OutboxRecord[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<Row>(
      `SELECT o.* FROM outbox o
       JOIN (SELECT aggregate, MIN(id) AS head_id FROM outbox
             WHERE status = 'pending' GROUP BY aggregate) h
         ON o.id = h.head_id
       WHERE o.next_attempt_at <= ?
       ORDER BY o.id`,
      [nowMs],
    );
    return rows.map(toRecord);
  }

  async markDone(id: number): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM outbox WHERE id = ?', [id]);
  }

  async markFailed(
    id: number,
    error: string,
    nextAttemptAt: number,
    poison: boolean,
  ): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE outbox
       SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, status = ?
       WHERE id = ?`,
      [error, nextAttemptAt, poison ? 'poison' : 'pending', id],
    );
  }

  async poisoned(): Promise<OutboxRecord[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<Row>(
      "SELECT * FROM outbox WHERE status = 'poison' ORDER BY id",
    );
    return rows.map(toRecord);
  }

  async pendingCount(): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'",
    );
    return row?.n ?? 0;
  }
}
