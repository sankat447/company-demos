/**
 * Staff scanner data (Phase 2): the checkpoint list + the festival-wide, names-
 * free entitlement snapshot the device syncs every few minutes so per-event
 * checks work offline. Also records scans through /admin/scan with a local
 * fallback queue that drains when signal returns.
 *
 * The snapshot is names-free (opaque sub → [checkpoint ids]); it is wiped on
 * sign-out. (Names/age come from the signed QR itself, never this cache.)
 */
import { adminFetch } from '@/auth/adminAuth';
import type { KvStore } from '@/offline/jwks';

export interface Checkpoint {
  type: string;
  id: string;
  label: string;
}
export type EntitlementSnapshot = Record<string, string[]>;

const CP_KEY = 'staff.checkpoints.v1';
const SEL_KEY = 'staff.checkpoint.selected.v1';
const ENT_KEY = 'staff.entitlements.v1';
const PENDING_KEY = 'staff.scan.pending.v1';

/* ---- checkpoints ---- */
export async function syncCheckpoints(kv: KvStore): Promise<Checkpoint[]> {
  const r = await adminFetch<{ checkpoints: Checkpoint[] }>('GET', '/admin/checkpoints');
  const list = r.checkpoints || [];
  await kv.set(CP_KEY, JSON.stringify(list));
  return list;
}
export async function loadCheckpoints(kv: KvStore): Promise<Checkpoint[]> {
  try {
    const raw = await kv.get(CP_KEY);
    return raw ? (JSON.parse(raw) as Checkpoint[]) : [];
  } catch {
    return [];
  }
}
export async function getSelectedCheckpoint(kv: KvStore): Promise<string | null> {
  return (await kv.get(SEL_KEY)) || null;
}
export async function setSelectedCheckpoint(kv: KvStore, id: string): Promise<void> {
  await kv.set(SEL_KEY, id);
}

/* ---- entitlement snapshot ---- */
export async function syncEntitlements(kv: KvStore): Promise<{ version: number; count: number }> {
  const r = await adminFetch<{ version: number; entitlements: EntitlementSnapshot }>(
    'GET',
    '/admin/entitlements/snapshot',
  );
  const ent = r.entitlements || {};
  await kv.set(ENT_KEY, JSON.stringify(ent));
  return { version: r.version, count: Object.keys(ent).length };
}
export async function loadEntitlements(kv: KvStore): Promise<EntitlementSnapshot> {
  try {
    const raw = await kv.get(ENT_KEY);
    return raw ? (JSON.parse(raw) as EntitlementSnapshot) : {};
  } catch {
    return {};
  }
}
export function isEntitled(
  snapshot: EntitlementSnapshot,
  sub: string,
  checkpointId: string,
): boolean {
  return (snapshot[sub] || []).includes(checkpointId);
}

/* ---- scan recording (online, with an offline fallback queue) ---- */
export interface PendingScan {
  qrToken: string;
  checkpoint: string;
  ts: number;
}
export async function recordScan(kv: KvStore, scan: PendingScan): Promise<boolean> {
  try {
    await adminFetch('POST', '/admin/scan', scan);
    return true;
  } catch {
    const q = await loadPending(kv);
    q.push(scan);
    await kv.set(PENDING_KEY, JSON.stringify(q.slice(-500)));
    return false;
  }
}
async function loadPending(kv: KvStore): Promise<PendingScan[]> {
  try {
    const raw = await kv.get(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingScan[]) : [];
  } catch {
    return [];
  }
}
export async function pendingScanCount(kv: KvStore): Promise<number> {
  return (await loadPending(kv)).length;
}
/** Flush queued scans; keeps any that still fail. */
export async function drainPendingScans(kv: KvStore): Promise<number> {
  const q = await loadPending(kv);
  if (!q.length) return 0;
  const remaining: PendingScan[] = [];
  for (const scan of q) {
    try {
      await adminFetch('POST', '/admin/scan', scan);
    } catch {
      remaining.push(scan);
    }
  }
  await kv.set(PENDING_KEY, JSON.stringify(remaining));
  return q.length - remaining.length;
}

/** Wipe all staff scanner data on sign-out (names-free, but still local state). */
export async function wipeStaffData(kv: KvStore): Promise<void> {
  await Promise.all([
    kv.set(ENT_KEY, ''),
    kv.set(CP_KEY, ''),
    kv.set(SEL_KEY, ''),
    kv.set(PENDING_KEY, ''),
  ]);
}
