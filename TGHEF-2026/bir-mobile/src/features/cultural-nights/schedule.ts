/**
 * Cultural-nights schedule (P3.2): reads the delta-synced SQLite `schedule`
 * table — the screen renders identically with airplane mode on. Parsing and
 * ordering are pure so they unit-test without a database.
 */
import { getDb } from '@/offline/db';

/** Every evening of the festival (CO-001 module B). */
export const FESTIVAL_DAYS = ['2026-11-21', '2026-11-22', '2026-11-23'] as const;
export type FestivalDay = (typeof FESTIVAL_DAYS)[number];

export interface ScheduleEvent {
  id: string;
  day: string;
  venue?: string | null;
  /** AWSTimestamp — seconds since epoch (as delivered by scheduleDelta). */
  startsAtSec?: number | null;
  endsAtSec?: number | null;
  titleEn?: string | null;
  titleHi?: string | null;
  /** From data_json: audience-favourite voting powers the award ceremonies. */
  votable: boolean;
  category?: string | null;
  seatReservable: boolean;
}

export interface ScheduleRow {
  id: string;
  day: string;
  venue: string | null;
  starts_at: number | null;
  ends_at: number | null;
  title_en: string | null;
  title_hi: string | null;
  data_json: string | null;
}

export function parseScheduleRow(row: ScheduleRow): ScheduleEvent {
  let data: { votable?: boolean; category?: string; seatReservable?: boolean } = {};
  if (row.data_json) {
    try {
      data = JSON.parse(row.data_json) as typeof data;
    } catch {
      // tolerate malformed extras; the core columns still render
    }
  }
  return {
    id: row.id,
    day: row.day,
    venue: row.venue,
    startsAtSec: row.starts_at,
    endsAtSec: row.ends_at,
    titleEn: row.title_en,
    titleHi: row.title_hi,
    votable: data.votable === true,
    category: data.category ?? null,
    seatReservable: data.seatReservable === true,
  };
}

/** Chronological; events without a start time sink to the end. */
export function sortEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort(
    (a, b) =>
      (a.startsAtSec ?? Number.MAX_SAFE_INTEGER) - (b.startsAtSec ?? Number.MAX_SAFE_INTEGER),
  );
}

export async function listEventsForDay(day: string): Promise<ScheduleEvent[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ScheduleRow>(
    'SELECT id, day, venue, starts_at, ends_at, title_en, title_hi, data_json FROM schedule WHERE day = ?',
    [day],
  );
  return sortEvents(rows.map(parseScheduleRow));
}
