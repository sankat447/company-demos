/**
 * Event reminders via LOCAL notifications (P3.2) — no push infrastructure
 * needed; works offline. The notifier is injected so trigger math and the
 * on/off toggle unit-test without native modules.
 */
import type { KvStore } from '@/offline/jwks';

import type { ScheduleEvent } from './schedule';

export const DEFAULT_LEAD_MINUTES = 30;

const REMINDERS_KEY = 'reminders.byEvent';

export interface Notifier {
  requestPermissions(): Promise<boolean>;
  /** Returns the platform notification identifier. */
  schedule(input: { title: string; body: string; dateMs: number }): Promise<string>;
  cancel(identifier: string): Promise<void>;
}

/** Fire time in epoch-ms, or null when it would already be in the past. */
export function reminderTimeMs(
  startsAtSec: number,
  nowMs: number,
  leadMinutes: number = DEFAULT_LEAD_MINUTES,
): number | null {
  const fireAt = startsAtSec * 1000 - leadMinutes * 60_000;
  return fireAt > nowMs ? fireAt : null;
}

async function reminderMap(kv: KvStore): Promise<Record<string, string>> {
  const rawValue = await kv.get(REMINDERS_KEY);
  if (!rawValue) return {};
  try {
    return JSON.parse(rawValue) as Record<string, string>;
  } catch {
    return {};
  }
}

export type ReminderToggle = 'on' | 'off' | 'permission-denied' | 'in-past';

export async function toggleReminder(
  kv: KvStore,
  event: ScheduleEvent,
  copy: { title: string; body: string },
  nowMs: number,
  notifier: Notifier,
  leadMinutes: number = DEFAULT_LEAD_MINUTES,
): Promise<ReminderToggle> {
  const map = await reminderMap(kv);
  const existing = map[event.id];

  if (existing) {
    await notifier.cancel(existing);
    delete map[event.id];
    await kv.set(REMINDERS_KEY, JSON.stringify(map));
    return 'off';
  }

  if (!event.startsAtSec) return 'in-past';
  const dateMs = reminderTimeMs(event.startsAtSec, nowMs, leadMinutes);
  if (dateMs === null) return 'in-past';

  if (!(await notifier.requestPermissions())) return 'permission-denied';

  map[event.id] = await notifier.schedule({ ...copy, dateMs });
  await kv.set(REMINDERS_KEY, JSON.stringify(map));
  return 'on';
}

export async function remindedEventIds(kv: KvStore): Promise<Set<string>> {
  return new Set(Object.keys(await reminderMap(kv)));
}

/** Production notifier backed by expo-notifications (lazy native import). */
export function expoNotifier(): Notifier {
  return {
    async requestPermissions() {
      const Notifications = await import('expo-notifications');
      const settings = await Notifications.getPermissionsAsync();
      if (settings.granted) return true;
      const requested = await Notifications.requestPermissionsAsync();
      return requested.granted;
    },
    async schedule({ title, body, dateMs }) {
      const Notifications = await import('expo-notifications');
      return Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(dateMs),
        },
      });
    },
    async cancel(identifier) {
      const Notifications = await import('expo-notifications');
      await Notifications.cancelScheduledNotificationAsync(identifier);
    },
  };
}
