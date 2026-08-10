/**
 * Delta sync jobs (P2.4): schedule + revocations pull on app foreground and
 * on push nudge. Cursors persist in kv so every pull is incremental.
 */
import { gqlClient, REVOCATIONS_DELTA, SCHEDULE_DELTA } from '@/api/graphql';

import { getDb, kvStore } from './db';

const CURSOR_SCHEDULE = 'sync.cursor.schedule';
const CURSOR_REVOCATIONS = 'sync.cursor.revocations';

interface ScheduleItem {
  id: string;
  day: string;
  venue?: string | null;
  startsAt?: number | null;
  endsAt?: number | null;
  titleEn?: string | null;
  titleHi?: string | null;
  data?: string | null;
}

interface RevocationItem {
  jti: string;
  revokedAt: number;
}

export async function pullScheduleDelta(nowMs: number): Promise<number> {
  const since = Number((await kvStore.get(CURSOR_SCHEDULE)) ?? 0);
  const res = (await gqlClient().graphql({
    query: SCHEDULE_DELTA,
    variables: { since },
  })) as { data?: { scheduleDelta?: { items: ScheduleItem[]; cursor: number } } };

  const delta = res.data?.scheduleDelta;
  if (!delta) return 0;

  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const item of delta.items) {
      await tx.runAsync(
        `INSERT INTO schedule (id, day, venue, starts_at, ends_at, title_en, title_hi, data_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           day = excluded.day, venue = excluded.venue,
           starts_at = excluded.starts_at, ends_at = excluded.ends_at,
           title_en = excluded.title_en, title_hi = excluded.title_hi,
           data_json = excluded.data_json, updated_at = excluded.updated_at`,
        [
          item.id,
          item.day,
          item.venue ?? null,
          item.startsAt ?? null,
          item.endsAt ?? null,
          item.titleEn ?? null,
          item.titleHi ?? null,
          item.data ?? null,
          nowMs,
        ],
      );
    }
  });
  await kvStore.set(CURSOR_SCHEDULE, String(delta.cursor));
  return delta.items.length;
}

export async function pullRevocationsDelta(): Promise<number> {
  const since = Number((await kvStore.get(CURSOR_REVOCATIONS)) ?? 0);
  const res = (await gqlClient().graphql({
    query: REVOCATIONS_DELTA,
    variables: { since },
  })) as { data?: { revocationsDelta?: { items: RevocationItem[]; cursor: number } } };

  const delta = res.data?.revocationsDelta;
  if (!delta) return 0;

  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const item of delta.items) {
      await tx.runAsync(
        'INSERT INTO revocations (jti, revoked_at) VALUES (?, ?) ON CONFLICT(jti) DO NOTHING',
        [item.jti, item.revokedAt],
      );
    }
  });
  await kvStore.set(CURSOR_REVOCATIONS, String(delta.cursor));
  return delta.items.length;
}

/**
 * Load all revoked jtis into a Set for synchronous checks during a scan
 * burst (the verdict path must not await per-scan). Bounded per festival.
 */
export async function loadRevokedSet(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ jti: string }>('SELECT jti FROM revocations');
  return new Set(rows.map((r) => r.jti));
}

export async function isRevoked(jti: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ jti: string }>('SELECT jti FROM revocations WHERE jti = ?', [
    jti,
  ]);
  return row !== null;
}
