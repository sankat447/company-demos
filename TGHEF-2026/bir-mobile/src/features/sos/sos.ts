/**
 * One-tap SOS (P3.3, CO-001 E4). Two independent actions, in strict order of
 * reliability:
 *   1. CALL — through the OS dialer; never depends on our backend or data.
 *   2. LOCATION REPORT — once, with consent (the OS permission prompt at the
 *      moment of use), queued through the outbox so a dead network at Chogan
 *      still delivers it on reconnect.
 * Never mocked in production paths (CLAUDE.md).
 */
import type { OutboxStore } from '@/offline/outbox';

/** Until the contract exports ops.emergencyPhone (BACKEND_ASKS #18):
 *  112 is India's national emergency number. */
export const FALLBACK_EMERGENCY_PHONE = '112';

export interface SosDeps {
  outbox: OutboxStore;
  openUrl(url: string): Promise<void>;
  /** Resolves null when the user declines the location permission. */
  getLocation(): Promise<{ lat: number; lng: number } | null>;
}

export interface SosOutcome {
  called: boolean;
  locationQueued: boolean;
}

export async function triggerSos(
  deps: SosDeps,
  input: { sub: string; phone?: string; nowMs: number },
): Promise<SosOutcome> {
  const outcome: SosOutcome = { called: false, locationQueued: false };

  try {
    await deps.openUrl(`tel:${input.phone ?? FALLBACK_EMERGENCY_PHONE}`);
    outcome.called = true;
  } catch {
    // Dialer failure must not block the location report.
  }

  const location = await deps.getLocation().catch(() => null);
  if (location) {
    await deps.outbox.enqueue(
      {
        aggregate: `sos:${input.sub}`,
        mutation: 'reportSos',
        variables: { lat: location.lat, lng: location.lng, ts: Math.floor(input.nowMs / 1000) },
        idempotencyKey: `sos:${input.sub}:${input.nowMs}`,
      },
      input.nowMs,
    );
    outcome.locationQueued = true;
  }

  return outcome;
}

/** Production location getter: single shot — "report location once". */
export async function getLocationOnce(): Promise<{ lat: number; lng: number } | null> {
  const Location = await import('expo-location');
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return null;
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}
