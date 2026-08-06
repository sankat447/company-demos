/**
 * Push registration (P3.4). The client's whole job (ARCHITECTURE.md §3):
 * register the native FCM/APNs token + preferences with the backend, which
 * owns the Pinpoint endpoint. Quiet hours and per-user budgets are enforced
 * SERVER-side — the local copy only drives the preferences UI.
 *
 * Registration rides the outbox: it retries with backoff offline, and a
 * changed token/prefs produces a new idempotency key so upserts go through.
 */
import { Platform } from 'react-native';

import type { KvStore } from '@/offline/jwks';
import type { OutboxStore } from '@/offline/outbox';

export interface QuietHours {
  enabled: boolean;
  /** 0–23, local device hours; window may wrap midnight. */
  startHour: number;
  endHour: number;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: true, startHour: 22, endHour: 7 };

const QUIET_HOURS_KEY = 'push.quietHours';

export async function loadQuietHours(kv: KvStore): Promise<QuietHours> {
  const rawValue = await kv.get(QUIET_HOURS_KEY);
  if (!rawValue) return DEFAULT_QUIET_HOURS;
  try {
    const parsed = JSON.parse(rawValue) as QuietHours;
    if (
      typeof parsed.enabled === 'boolean' &&
      Number.isInteger(parsed.startHour) &&
      Number.isInteger(parsed.endHour)
    ) {
      return parsed;
    }
    return DEFAULT_QUIET_HOURS;
  } catch {
    return DEFAULT_QUIET_HOURS;
  }
}

export async function saveQuietHours(kv: KvStore, quietHours: QuietHours): Promise<void> {
  await kv.set(QUIET_HOURS_KEY, JSON.stringify(quietHours));
}

/** Informative client-side check; the notification service is authoritative. */
export function isInQuietHours(quietHours: QuietHours, hour: number): boolean {
  if (!quietHours.enabled) return false;
  const { startHour, endHour } = quietHours;
  if (startHour === endHour) return false;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour; // wraps midnight (e.g. 22 → 7)
}

export interface DeviceRegistration {
  sub: string;
  token: string;
  platform: 'FCM' | 'APNS';
  locale: string;
  roles: string[];
  quietHours: QuietHours;
}

/** Short stable hash so the idempotency key changes iff the payload changes. */
function registrationHash(input: DeviceRegistration): string {
  const canonical = JSON.stringify([
    input.token,
    input.platform,
    input.locale,
    [...input.roles].sort(),
    input.quietHours.enabled,
    input.quietHours.startHour,
    input.quietHours.endHour,
  ]);
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) + hash + canonical.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export async function queueDeviceRegistration(
  outbox: OutboxStore,
  input: DeviceRegistration,
  nowMs: number,
): Promise<void> {
  await outbox.enqueue(
    {
      aggregate: `device:${input.sub}`,
      mutation: 'registerDevice',
      variables: {
        token: input.token,
        platform: input.platform,
        locale: input.locale,
        roles: input.roles,
        quietStartHour: input.quietHours.enabled ? input.quietHours.startHour : null,
        quietEndHour: input.quietHours.enabled ? input.quietHours.endHour : null,
      },
      idempotencyKey: `device:${input.sub}:${registrationHash(input)}`,
    },
    nowMs,
  );
}

/** Native token via expo-notifications; null when permission is declined
 *  or the device has no push services (e.g. bare emulator). */
export async function getNativePushToken(): Promise<{
  token: string;
  platform: 'FCM' | 'APNS';
} | null> {
  try {
    const Notifications = await import('expo-notifications');
    const settings = await Notifications.getPermissionsAsync();
    const granted = settings.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return null;
    const device = await Notifications.getDevicePushTokenAsync();
    return {
      token: String(device.data),
      platform: Platform.OS === 'ios' ? 'APNS' : 'FCM',
    };
  } catch {
    return null;
  }
}
