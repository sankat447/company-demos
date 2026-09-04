/**
 * Festival-wide announcements (read side). Notices are posted from the ops
 * console; this pulls the active ones for display. Live when reachable, cached
 * last-known otherwise (offline-first) — never invented.
 */
import { ANNOUNCEMENTS, gqlClient } from '@/api/graphql';
import type { KvStore } from '@/offline/jwks';

export type AnnouncementLevel = 'info' | 'alert';
export interface Announcement {
  id: string;
  titleEn: string;
  titleHi?: string | null;
  bodyEn: string;
  bodyHi?: string | null;
  level: AnnouncementLevel;
  updatedAt?: number | null;
}

const CACHE_KEY = 'announcements.cache';

function parse(list: unknown): Announcement[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      id: String(a.id ?? ''),
      titleEn: String(a.titleEn ?? ''),
      titleHi: (a.titleHi as string) ?? null,
      bodyEn: String(a.bodyEn ?? ''),
      bodyHi: (a.bodyHi as string) ?? null,
      level: (a.level === 'alert' ? 'alert' : 'info') as AnnouncementLevel,
      updatedAt: typeof a.updatedAt === 'number' ? a.updatedAt : null,
    }))
    .filter((a) => a.id && a.titleEn)
    .sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0));
}

async function query(): Promise<unknown> {
  const res = (await gqlClient().graphql({ query: ANNOUNCEMENTS })) as {
    data?: { announcements?: unknown };
  };
  return res.data?.announcements ?? [];
}

/** Localised title/body for the given locale (falls back to English). */
export function announcementText(a: Announcement, locale: string): { title: string; body: string } {
  const hi = locale.startsWith('hi');
  return {
    title: (hi && a.titleHi) || a.titleEn,
    body: (hi && a.bodyHi) || a.bodyEn,
  };
}

export async function loadAnnouncements(
  kv: KvStore,
  fetchList: () => Promise<unknown> = query,
): Promise<Announcement[]> {
  try {
    const list = parse(await fetchList());
    await kv.set(CACHE_KEY, JSON.stringify(list));
    return list;
  } catch {
    const raw = await kv.get(CACHE_KEY);
    if (!raw) return [];
    try {
      return parse(JSON.parse(raw));
    } catch {
      return [];
    }
  }
}
