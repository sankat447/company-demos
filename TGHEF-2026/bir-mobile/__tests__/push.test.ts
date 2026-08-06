import {
  DEFAULT_QUIET_HOURS,
  isInQuietHours,
  loadQuietHours,
  queueDeviceRegistration,
  saveQuietHours,
  type DeviceRegistration,
} from '@/features/notifications/push';
import type { KvStore } from '@/offline/jwks';
import { MemoryOutboxStore } from '@/offline/outbox';

function memoryKv(): KvStore {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}

const NOW_MS = 1_763_700_000_000;

function registration(overrides: Partial<DeviceRegistration> = {}): DeviceRegistration {
  return {
    sub: 'u1',
    token: 'fcm-token-abc',
    platform: 'FCM',
    locale: 'hi',
    roles: ['visitor'],
    quietHours: DEFAULT_QUIET_HOURS,
    ...overrides,
  };
}

describe('quiet hours', () => {
  it('defaults to 22:00–07:00 and round-trips through kv', async () => {
    const kv = memoryKv();
    expect(await loadQuietHours(kv)).toEqual(DEFAULT_QUIET_HOURS);

    const custom = { enabled: true, startHour: 23, endHour: 6 };
    await saveQuietHours(kv, custom);
    expect(await loadQuietHours(kv)).toEqual(custom);
  });

  it('falls back to defaults on corrupt storage', async () => {
    const kv = memoryKv();
    await kv.set('push.quietHours', '{broken');
    expect(await loadQuietHours(kv)).toEqual(DEFAULT_QUIET_HOURS);
  });

  it('handles windows that wrap midnight', () => {
    const wrap = { enabled: true, startHour: 22, endHour: 7 };
    expect(isInQuietHours(wrap, 23)).toBe(true);
    expect(isInQuietHours(wrap, 3)).toBe(true);
    expect(isInQuietHours(wrap, 7)).toBe(false);
    expect(isInQuietHours(wrap, 12)).toBe(false);

    const sameDay = { enabled: true, startHour: 13, endHour: 15 };
    expect(isInQuietHours(sameDay, 14)).toBe(true);
    expect(isInQuietHours(sameDay, 15)).toBe(false);

    expect(isInQuietHours({ enabled: false, startHour: 22, endHour: 7 }, 23)).toBe(false);
    expect(isInQuietHours({ enabled: true, startHour: 5, endHour: 5 }, 5)).toBe(false);
  });
});

describe('device registration via outbox', () => {
  it('carries token, platform, roles, locale and quiet hours to the backend', async () => {
    const outbox = new MemoryOutboxStore();
    await queueDeviceRegistration(outbox, registration(), NOW_MS);

    const [head] = await outbox.dueHeads(NOW_MS);
    expect(head.aggregate).toBe('device:u1');
    expect(head.mutation).toBe('registerDevice');
    expect(head.variables).toEqual({
      token: 'fcm-token-abc',
      platform: 'FCM',
      locale: 'hi',
      roles: ['visitor'],
      quietStartHour: 22,
      quietEndHour: 7,
    });
  });

  it('nulls the quiet window when disabled', async () => {
    const outbox = new MemoryOutboxStore();
    await queueDeviceRegistration(
      outbox,
      registration({ quietHours: { enabled: false, startHour: 22, endHour: 7 } }),
      NOW_MS,
    );
    const [head] = await outbox.dueHeads(NOW_MS);
    expect(head.variables.quietStartHour).toBeNull();
    expect(head.variables.quietEndHour).toBeNull();
  });

  it('dedupes identical payloads, re-queues when anything changes', async () => {
    const outbox = new MemoryOutboxStore();
    await queueDeviceRegistration(outbox, registration(), NOW_MS);
    await queueDeviceRegistration(outbox, registration(), NOW_MS + 10); // identical → dedup
    expect(await outbox.pendingCount()).toBe(1);

    await queueDeviceRegistration(outbox, registration({ locale: 'en' }), NOW_MS + 20);
    await queueDeviceRegistration(outbox, registration({ token: 'fcm-token-new' }), NOW_MS + 30);
    await queueDeviceRegistration(
      outbox,
      registration({ quietHours: { enabled: true, startHour: 21, endHour: 7 } }),
      NOW_MS + 40,
    );
    expect(await outbox.pendingCount()).toBe(4);
  });

  it('role order does not change the idempotency key', async () => {
    const outbox = new MemoryOutboxStore();
    await queueDeviceRegistration(
      outbox,
      registration({ roles: ['volunteer', 'visitor'] }),
      NOW_MS,
    );
    await queueDeviceRegistration(
      outbox,
      registration({ roles: ['visitor', 'volunteer'] }),
      NOW_MS + 10,
    );
    expect(await outbox.pendingCount()).toBe(1);
  });
});
