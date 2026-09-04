/**
 * Staff (admin) auth for the mobile Staff mode — the SAME username/password
 * 4-tier system as the web ops console, reached through the admin API
 * (/admin/auth/login). Kept entirely separate from the visitor Cognito session:
 * staff never sign in with a phone, visitors never get an admin token.
 *
 * The signed JWT (HS256, backend secret) is stored locally; the app sends it as
 * a Bearer token to /admin/*. On expiry the caller re-authenticates.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { restUrl } from '@/config/stack';

export interface AdminSession {
  token: string;
  username: string;
  name: string;
  tier: number;
  tierName: string;
}
const KEY = 'bir.admin.session.v1';
export const TIER_NAMES: Record<number, string> = {
  1: 'Superadmin',
  2: 'Admin',
  3: 'Manager',
  4: 'Coordinator',
};
export const CAPS: Record<string, number[]> = {
  'analytics.read': [1, 2, 3, 4],
  'admin.manage': [1, 2, 3],
  'faq.write': [1, 2, 3],
  'pass.revoke': [1, 2],
  'flystatus.set': [1, 2],
  'schedule.manage': [1, 2, 3],
  'stalls.manage': [1, 2, 3],
  'lodging.manage': [1, 2, 3],
  'volunteers.manage': [1, 2, 3],
  'incidents.manage': [1, 2, 3, 4],
  'announce.write': [1, 2],
};
export const adminCan = (tier: number, cap: string): boolean => (CAPS[cap] || []).includes(tier);

function decodeExp(token: string): number {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(globalThis.atob(p + '==='.slice((p.length + 3) % 4)));
    return typeof json.exp === 'number' ? json.exp : 0;
  } catch {
    return 0;
  }
}

export async function adminLogin(username: string, password: string): Promise<AdminSession> {
  const res = await fetch(restUrl('/admin/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password }),
  });
  const j = (await res.json().catch(() => ({}))) as {
    token?: string;
    admin?: { username: string; name: string; tier: number; tierName: string };
    error?: string;
  };
  if (!res.ok || !j.token || !j.admin) throw new Error(j.error || 'invalid username or password');
  const session: AdminSession = {
    token: j.token,
    username: j.admin.username,
    name: j.admin.name,
    tier: Number(j.admin.tier),
    tierName: j.admin.tierName || TIER_NAMES[Number(j.admin.tier)],
  };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
  return session;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AdminSession;
    if (!s.token || decodeExp(s.token) * 1000 <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export async function adminLogout(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Authenticated call to the admin API with the stored staff token. */
export async function adminFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const s = await getAdminSession();
  if (!s) throw new Error('not signed in');
  const res = await fetch(restUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${s.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; detail?: string };
  if (!res.ok)
    throw new Error(
      (j as { detail?: string }).detail ||
        (j as { error?: string }).error ||
        `${method} ${path} failed`,
    );
  return j;
}
