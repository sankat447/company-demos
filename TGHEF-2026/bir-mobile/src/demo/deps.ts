/** On-device wiring for demo mode (SQLite + kv). Kept apart from demo.ts so
 *  the seeding/OTP logic stays hermetically testable. */
import { savePass } from '@/features/tickets/passStore';
import { getDb, kvStore } from '@/offline/db';
import { primeJwksCache } from '@/offline/jwks';

import type { DemoScheduleRow, DemoSeedDeps } from './demo';

async function insertScheduleRow(row: DemoScheduleRow): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO schedule (id, day, venue, starts_at, ends_at, title_en, title_hi, data_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [
      row.id,
      row.day,
      row.venue,
      row.startsAtSec,
      row.endsAtSec,
      row.titleEn,
      row.titleHi,
      row.dataJson,
      Date.now(),
    ],
  );
}

export function demoDeps(): DemoSeedDeps {
  return { kv: kvStore, primeJwks: primeJwksCache, savePass, insertScheduleRow };
}
