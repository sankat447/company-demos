import { useQuery } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { hasRole, useAuth } from '@/auth/useAuth';
import { processScan } from '@/features/scanner/processScan';
import { SqliteScanStore } from '@/features/scanner/scanStore';
import { VERDICT_I18N_KEY, type ScanVerdict } from '@/features/scanner/verdict';
import { ensureFreshJwks } from '@/offline/jwks';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { loadRevokedSet } from '@/offline/sync';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const scans = new SqliteScanStore();
const outbox = new SqliteOutboxStore();
const GATE = 'main'; // organiser-lite picks the gate zone in a fuller build

const VERDICT_TONE: Record<ScanVerdict, 'ok' | 'bad'> = {
  valid: 'ok',
  expired: 'bad',
  'not-yet-valid': 'bad',
  revoked: 'bad',
  'wrong-zone': 'bad',
  duplicate: 'bad',
  'bad-signature': 'bad',
  malformed: 'bad',
};

/**
 * P4.1 gate scanner: camera → offline verdict (<1 s) → record + queue.
 * The verdict pipeline (processScan → evaluateScan) is unit-tested and
 * forgery-proof; this screen is the camera surface + operator feedback.
 * P4.3 kiosk toggle keeps the screen awake and pins the scanner.
 */
export default function Scanner() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [kiosk, setKiosk] = useState(false);
  const [last, setLast] = useState<{ verdict: ScanVerdict; ts: number } | null>(null);
  const busy = useRef(false);

  const pending = useQuery({
    queryKey: ['scans', 'pending'],
    queryFn: () => scans.pendingCount(),
    refetchInterval: 4000,
    networkMode: 'always',
  });

  useEffect(() => {
    if (kiosk) void activateKeepAwakeAsync('scanner');
    else void deactivateKeepAwake('scanner');
    return () => {
      void deactivateKeepAwake('scanner');
    };
  }, [kiosk]);

  const onScan = useCallback(
    async (token: string) => {
      if (busy.current) return;
      busy.current = true;
      try {
        // Load JWKS + the revocation set up front so the verdict path is
        // synchronous and correct (a revoked pass is rejected before it can
        // be recorded/queued).
        const [jwks, revoked] = await Promise.all([
          ensureFreshJwks(kvStore, Date.now()),
          loadRevokedSet(),
        ]);
        const result = await processScan(
          token,
          {
            jwks,
            nowSec: Math.floor(Date.now() / 1000),
            gateZone: GATE,
            isRevoked: (jti) => revoked.has(jti),
          },
          { scans, outbox, gate: GATE, deviceId: 'device' },
          Date.now(),
        );
        const verdict = result.verdict;
        setLast({ verdict, ts: Date.now() });
        void Haptics.notificationAsync(
          verdict === 'valid'
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error,
        );
        await pending.refetch();
      } finally {
        // brief debounce so one QR doesn't fire repeatedly
        setTimeout(() => {
          busy.current = false;
        }, 1200);
      }
    },
    [pending],
  );

  if (!hasRole(auth, 'volunteer') && !hasRole(auth, 'organiser-lite')) {
    return (
      <Screen title={t('scanner.title')}>
        <Text style={styles.muted}>{t('scanner.needRole')}</Text>
      </Screen>
    );
  }

  if (!permission?.granted) {
    return (
      <Screen title={t('scanner.title')}>
        <Text style={styles.muted}>{t('scanner.permissionNeeded')}</Text>
        <Pressable
          style={styles.primary}
          onPress={requestPermission}
          accessibilityRole="button"
          accessibilityLabel={t('scanner.grant')}
        >
          <Text style={styles.primaryText}>{t('scanner.grant')}</Text>
        </Pressable>
      </Screen>
    );
  }

  const tone = last ? VERDICT_TONE[last.verdict] : null;

  return (
    <Screen title={t('scanner.title')}>
      <View style={styles.kioskRow}>
        <Text style={styles.kioskLabel}>{t('scanner.kioskMode')}</Text>
        <Switch
          value={kiosk}
          onValueChange={setKiosk}
          accessibilityLabel={t('scanner.kioskMode')}
          trackColor={{ true: color.primary, false: color.cardBorder }}
        />
      </View>

      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => void onScan(data)}
        />
      </View>

      {last ? (
        <View style={[styles.verdict, tone === 'ok' ? styles.verdictOk : styles.verdictBad]}>
          <Text style={styles.verdictText}>{t(VERDICT_I18N_KEY[last.verdict])}</Text>
        </View>
      ) : (
        <Text style={styles.hint}>{t('scanner.point')}</Text>
      )}

      <View style={styles.badge}>
        <Text style={styles.badgeText}>
          {t('scanner.pendingSync', { count: pending.data ?? 0 })}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.md },
  primary: {
    marginTop: spacing.md,
    backgroundColor: color.primary,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...typeScale.body, color: color.textInverse, fontWeight: '600' },
  kioskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  kioskLabel: { ...typeScale.body, color: color.text },
  cameraWrap: {
    height: 300,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: palette.ink,
  },
  hint: { ...typeScale.body, color: color.textMuted, textAlign: 'center', marginTop: spacing.md },
  verdict: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  verdictOk: { backgroundColor: '#9CC5AE' },
  verdictBad: { backgroundColor: '#E7A79A' },
  verdictText: { ...typeScale.title, color: palette.ink, textAlign: 'center' },
  badge: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    backgroundColor: palette.ink,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  badgeText: { ...typeScale.caption, color: color.textInverse },
});
