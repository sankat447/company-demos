/**
 * SQLite schema + migrations (P2.1). One database, versioned with
 * PRAGMA user_version; every migration is additive and idempotent to run once.
 */
import * as SQLite from 'expo-sqlite';

const MIGRATIONS: string[] = [
  // v1 — offline core
  `
  CREATE TABLE IF NOT EXISTS passes (
    jti         TEXT PRIMARY KEY,
    typ         TEXT NOT NULL,
    token       TEXT NOT NULL,
    claims_json TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS revocations (
    jti        TEXT PRIMARY KEY,
    revoked_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scans (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    jti       TEXT NOT NULL,
    gate      TEXT NOT NULL,
    ts        INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    verdict   TEXT NOT NULL,
    synced    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (jti, gate)
  );
  CREATE TABLE IF NOT EXISTS schedule (
    id         TEXT PRIMARY KEY,
    day        TEXT NOT NULL,
    venue      TEXT,
    starts_at  INTEGER,
    ends_at    INTEGER,
    title_en   TEXT,
    title_hi   TEXT,
    data_json  TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS roster (
    id         TEXT PRIMARY KEY,
    shift_date TEXT,
    zone       TEXT,
    starts_at  INTEGER,
    ends_at    INTEGER,
    data_json  TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    aggregate       TEXT NOT NULL,
    mutation        TEXT NOT NULL,
    variables_json  TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_outbox_drain ON outbox (status, aggregate, id);
  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

let db: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Open + migrate exactly once, even under concurrent callers. Memoising only
 * the handle (not the in-flight promise) let a startup burst — useAuth, the
 * catalog + fly-status queries, the outbox drain — each open the file and run
 * the migration in an exclusive transaction at the same time, racing to
 * SQLITE_BUSY ("database is locked"). That transient surfaced as random auth
 * drops (the demo session read threw → treated as signed-out) and failed
 * registrations. Memoise the promise so everyone awaits one open; a failed
 * open clears the latch so the next call retries. busy_timeout is a second
 * belt: brief contention waits instead of throwing.
 */
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (!opening) {
    opening = (async () => {
      const opened = await SQLite.openDatabaseAsync('bir.db');
      await opened.execAsync(
        'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;',
      );
      const row = await opened.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      let version = row?.user_version ?? 0;
      while (version < MIGRATIONS.length) {
        await opened.withExclusiveTransactionAsync(async (tx) => {
          await tx.execAsync(MIGRATIONS[version]);
          await tx.execAsync(`PRAGMA user_version = ${version + 1}`);
        });
        version += 1;
      }
      db = opened;
      return opened;
    })().finally(() => {
      opening = null;
    });
  }
  return opening;
}

/** kv-table backed store, used by JWKS cache, sync cursors and locale pref. */
export const kvStore = {
  async get(key: string): Promise<string | null> {
    const d = await getDb();
    const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [
      key,
    ]);
    return row?.value ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    const d = await getDb();
    await d.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  },
};
