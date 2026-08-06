/**
 * Full registration flow: token + session roles + locale + quiet hours →
 * outbox. Safe to call on every signed-in app start; identical payloads
 * dedupe on the idempotency key.
 */
import { fetchAuthSession } from 'aws-amplify/auth';

import { currentLocale } from '@/i18n';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';

import { getNativePushToken, loadQuietHours, queueDeviceRegistration } from './push';

const outbox = new SqliteOutboxStore();

export async function registerPushIfPossible(): Promise<boolean> {
  try {
    const session = await fetchAuthSession();
    const sub = String(session.tokens?.idToken?.payload?.sub ?? '');
    if (!sub) return false;

    const native = await getNativePushToken();
    if (!native) return false;

    const groups =
      (session.tokens?.idToken?.payload?.['cognito:groups'] as string[] | undefined) ?? [];

    await queueDeviceRegistration(
      outbox,
      {
        sub,
        token: native.token,
        platform: native.platform,
        locale: currentLocale(),
        roles: groups.length ? groups : ['visitor'],
        quietHours: await loadQuietHours(kvStore),
      },
      Date.now(),
    );
    return true;
  } catch {
    return false; // never block the UI on push plumbing
  }
}
