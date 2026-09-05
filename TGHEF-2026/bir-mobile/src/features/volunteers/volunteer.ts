/**
 * Volunteer corps (P4.2). Roster + QR attendance + incident reporting +
 * certificate wallet. Attendance and incidents ride the outbox (offline-safe
 * per the field-sim gate: 200 mixed scans offline then sync — zero loss/dupe).
 * Pure over injected stores; the real data comes from GraphQL rosters
 * (BACKEND_ASKS) with the fixture behind flags.mockVolunteer.
 */
import type { KvStore } from '@/offline/jwks';
import type { OutboxStore } from '@/offline/outbox';

export interface Shift {
  id: string;
  date: string;
  zone: string;
  role: string;
  startsAtSec: number;
  endsAtSec: number;
}

export interface VolunteerProfile {
  sub: string;
  name: string;
  team: string;
  idVerified: boolean;
  shifts: Shift[];
  certificateJti?: string;
}

// ---- attendance (QR check-in / check-out, outbox-safe) ----

export type AttendanceKind = 'check-in' | 'check-out';

const ATTENDANCE_KEY = 'volunteer.attendance';

export interface AttendanceMark {
  shiftId: string;
  kind: AttendanceKind;
  atMs: number;
}

export async function recordedAttendance(kv: KvStore): Promise<AttendanceMark[]> {
  const raw = await kv.get(ATTENDANCE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AttendanceMark[];
  } catch {
    return [];
  }
}

/**
 * Mark attendance for a shift. Idempotent per (sub, shift, kind): a repeated
 * check-in is a no-op locally and dedupes server-side on the key.
 */
export async function markAttendance(
  deps: { kv: KvStore; outbox: OutboxStore },
  input: { sub: string; shiftId: string; kind: AttendanceKind },
  nowMs: number,
): Promise<'recorded' | 'already'> {
  const marks = await recordedAttendance(deps.kv);
  if (marks.some((m) => m.shiftId === input.shiftId && m.kind === input.kind)) return 'already';

  await deps.outbox.enqueue(
    {
      aggregate: `attendance:${input.sub}`,
      mutation: 'recordAttendance',
      variables: { shiftId: input.shiftId, kind: input.kind, ts: Math.floor(nowMs / 1000) },
      idempotencyKey: `att:${input.sub}:${input.shiftId}:${input.kind}`,
    },
    nowMs,
  );
  marks.push({ shiftId: input.shiftId, kind: input.kind, atMs: nowMs });
  await deps.kv.set(ATTENDANCE_KEY, JSON.stringify(marks));
  return 'recorded';
}

// ---- incident reporting (photo + category, offline-safe) ----

export type IncidentCategory = 'medical' | 'crowd' | 'lost-found' | 'safety' | 'other';
export const INCIDENT_CATEGORIES: IncidentCategory[] = [
  'medical',
  'crowd',
  'lost-found',
  'safety',
  'other',
];

export interface IncidentInput {
  sub: string;
  category: IncidentCategory;
  note: string;
  /** Local URI; uploaded via signed URL by the backend on drain. */
  photoUri?: string;
  zone?: string;
}

export async function fileIncident(
  outbox: OutboxStore,
  input: IncidentInput,
  nowMs: number,
): Promise<string> {
  const id = `inc:${input.sub}:${nowMs}`;
  await outbox.enqueue(
    {
      aggregate: `incidents:${input.sub}`,
      mutation: 'reportIncident',
      variables: {
        category: input.category,
        note: input.note,
        photoUri: input.photoUri ?? null,
        zone: input.zone ?? null,
        ts: Math.floor(nowMs / 1000),
      },
      idempotencyKey: id,
    },
    nowMs,
  );
  return id;
}
