/**
 * Lost-child / wristband lookup (Staff). A band id (printed on a child's
 * wristband) resolves to a guardian contact so any staff member can reunite a
 * lost child fast — offline-first: the full roster is synced on shift start and
 * every lookup reads the local snapshot, so it works with no signal at the gate.
 */
import { adminFetch } from '@/auth/adminAuth';
import { kvStore } from '@/offline/db';

const KEY = 'staff.wristbands.v1';
export const normBandId = (s: string) =>
  s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');

export interface Wristband {
  bandId: string;
  childName: string;
  ageBand?: string;
  guardianName?: string;
  guardianPhone: string;
  notes?: string;
  zone?: string;
}

/** Pull the full roster to the device (call on shift start / manual refresh). */
export async function syncWristbands(): Promise<Wristband[]> {
  const res = await adminFetch<{ items: Wristband[] }>('GET', '/admin/wristbands');
  const items = res.items || [];
  try {
    await kvStore.set(KEY, JSON.stringify(items));
  } catch {
    /* non-fatal */
  }
  return items;
}

export async function loadWristbands(): Promise<Wristband[]> {
  try {
    const raw = await kvStore.get(KEY);
    return raw ? (JSON.parse(raw) as Wristband[]) : [];
  } catch {
    return [];
  }
}

/** Offline lookup from the synced snapshot. */
export async function lookupWristband(id: string): Promise<Wristband | null> {
  const want = normBandId(id);
  if (!want) return null;
  const list = await loadWristbands();
  return list.find((b) => normBandId(b.bandId) === want) ?? null;
}

export async function registerWristband(band: {
  bandId: string;
  childName: string;
  ageBand?: string;
  guardianName?: string;
  guardianPhone: string;
  notes?: string;
  zone?: string;
}): Promise<void> {
  await adminFetch('POST', '/admin/wristbands', band);
  await syncWristbands().catch(() => {});
}
