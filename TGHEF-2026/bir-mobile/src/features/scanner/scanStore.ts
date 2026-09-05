/**
 * Local scan log (P4.1). Records every gate scan into the SQLite `scans`
 * table with a unique (jti, gate) index — the offline double-scan defense
 * (ARCHITECTURE.md §6 step 5). Same store interface + in-memory impl pattern
 * as the outbox, so the decision logic is unit-testable without a device.
 */
import { getDb } from '@/offline/db';
import type { ScanVerdict } from './verdict';

export interface ScanRecord {
  jti: string;
  gate: string;
  ts: number;
  deviceId: string;
  verdict: ScanVerdict;
}

export interface ScanStore {
  /** True when this (jti, gate) pair was already recorded locally. */
  isDuplicate(jti: string, gate: string): Promise<boolean>;
  record(scan: ScanRecord): Promise<void>;
  pendingCount(): Promise<number>;
}

export class SqliteScanStore implements ScanStore {
  async isDuplicate(jti: string, gate: string): Promise<boolean> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ jti: string }>(
      'SELECT jti FROM scans WHERE jti = ? AND gate = ?',
      [jti, gate],
    );
    return row !== null;
  }

  async record(scan: ScanRecord): Promise<void> {
    const db = await getDb();
    // INSERT OR IGNORE upholds the unique (jti, gate) index under races.
    await db.runAsync(
      `INSERT OR IGNORE INTO scans (jti, gate, ts, device_id, verdict, synced)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [scan.jti, scan.gate, scan.ts, scan.deviceId, scan.verdict],
    );
  }

  async pendingCount(): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM scans WHERE synced = 0',
    );
    return row?.n ?? 0;
  }
}

export class MemoryScanStore implements ScanStore {
  private scans: ScanRecord[] = [];
  async isDuplicate(jti: string, gate: string): Promise<boolean> {
    return this.scans.some((s) => s.jti === jti && s.gate === gate);
  }
  async record(scan: ScanRecord): Promise<void> {
    if (!(await this.isDuplicate(scan.jti, scan.gate))) this.scans.push(scan);
  }
  async pendingCount(): Promise<number> {
    return this.scans.length;
  }
  all(): ScanRecord[] {
    return [...this.scans];
  }
}
