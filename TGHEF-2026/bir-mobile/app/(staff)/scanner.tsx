import { useQuery } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { getAdminSession } from '@/auth/adminAuth';
import { evaluateStaffScan, type StaffScanOutcome } from '@/features/staffScan/evaluate';
import {
  drainPendingScans,
  getSelectedCheckpoint,
  isEntitled,
  loadCheckpoints,
  loadEntitlements,
  pendingScanCount,
  recordScan,
  setSelectedCheckpoint,
  syncCheckpoints,
  syncEntitlements,
  type Checkpoint,
} from '@/features/staffScan/sync';
import { kvStore } from '@/offline/db';
import { ensureFreshJwks } from '@/offline/jwks';
import { loadRevokedSet } from '@/offline/sync';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const V_KEY: Record<StaffScanOutcome['verdict'], string> = {
  valid: 'staffScan.vValid',
  'not-entitled': 'staffScan.vNotEntitled',
  revoked: 'staffScan.vRevoked',
  expired: 'staffScan.vExpired',
  'not-yet-valid': 'staffScan.vNotYetValid',
  'bad-signature': 'staffScan.vBadSignature',
  malformed: 'staffScan.vMalformed',
};

export default function StaffScanner() {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [last, setLast] = useState<StaffScanOutcome | null>(null);
  const [syncMsg, setSyncMsg] = useState<string>('');
  const [manual, setManual] = useState<string>('');
  const [scanErr, setScanErr] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const busy = useRef(false);

  const session = useQuery({
    queryKey: ['adminSession'],
    queryFn: getAdminSession,
    networkMode: 'always',
  });
  const pending = useQuery({
    queryKey: ['staffPending'],
    queryFn: () => pendingScanCount(kvStore),
    refetchInterval: 5000,
    networkMode: 'always',
  });

  // Load cached checkpoints/selection immediately, then sync in the background.
  useEffect(() => {
    void (async () => {
      const cached = await loadCheckpoints(kvStore);
      const sel = (await getSelectedCheckpoint(kvStore)) || cached[0]?.id || null;
      setCheckpoints(cached);
      setSelected(sel);
      selectedRef.current = sel;
      try {
        const [cps, ent] = await Promise.all([syncCheckpoints(kvStore), syncEntitlements(kvStore)]);
        setCheckpoints(cps);
        if (!sel && cps[0]) pick(cps[0].id);
        setSyncMsg(t('staffScan.syncedCount', { n: ent.count }));
        await drainPendingScans(kvStore);
        await pending.refetch();
      } catch {
        setSyncMsg(t('staffScan.offlineSnapshot'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (id: string) => {
    setSelected(id);
    selectedRef.current = id;
    void setSelectedCheckpoint(kvStore, id);
  };

  const onScan = useCallback(
    async (token: string) => {
      if (busy.current || !token) return;
      const cp = selectedRef.current;
      busy.current = true;
      setScanErr(null);
      try {
        const [jwks, revoked, snapshot] = await Promise.all([
          ensureFreshJwks(kvStore, Date.now()),
          loadRevokedSet(),
          loadEntitlements(kvStore),
        ]);
        const outcome = evaluateStaffScan(token, {
          jwks,
          nowSec: Math.floor(Date.now() / 1000),
          // No checkpoint selected → treat as a gate (any valid pass passes).
          checkpointId: cp ?? '',
          isRevoked: (jti) => revoked.has(jti),
          isEntitled: (sub, c) => isEntitled(snapshot, sub, c),
        });
        setLast(outcome);
        void Haptics.notificationAsync(
          outcome.verdict === 'valid'
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error,
        );
        // Only record a real gate scan when a checkpoint is chosen.
        if (cp) {
          void recordScan(kvStore, {
            qrToken: token,
            checkpoint: cp,
            ts: Math.floor(Date.now() / 1000),
          }).then(() => pending.refetch());
        }
      } catch (e) {
        // Never fail silently — surface why (e.g. JWKS/network) so the operator
        // isn't left staring at an unresponsive scanner.
        setLast(null);
        setScanErr(e instanceof Error ? e.message : t('staffScan.scanError'));
      } finally {
        setTimeout(() => {
          busy.current = false;
        }, 1400);
      }
    },
    [pending, t],
  );

  if (session.isLoading) {
    return (
      <Screen title={t('staffScan.title')}>
        <View style={styles.center}>
          <ParagliderSpinner />
        </View>
      </Screen>
    );
  }
  if (!session.data) return <Redirect href="/(staff)/sign-in" />;

  if (!permission?.granted) {
    return (
      <Screen title={t('staffScan.title')}>
        <Text style={styles.muted}>{t('staffScan.permissionNeeded')}</Text>
        <Pressable style={styles.primary} onPress={requestPermission} accessibilityRole="button">
          <Text style={styles.primaryText}>{t('staffScan.grant')}</Text>
        </Pressable>
      </Screen>
    );
  }

  const tone = last ? (last.verdict === 'valid' ? 'ok' : 'bad') : null;
  const selLabel = checkpoints.find((c) => c.id === selected)?.label;

  return (
    <Screen title={t('staffScan.title')}>
      <Text style={styles.sectionLabel}>{t('staffScan.selectCheckpoint')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {checkpoints.map((c) => (
          <Pressable
            key={c.id}
            style={[styles.chip, selected === c.id && styles.chipOn]}
            onPress={() => pick(c.id)}
            accessibilityRole="button"
          >
            <Text style={[styles.chipText, selected === c.id && styles.chipTextOn]}>{c.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => void onScan(data)}
        />
      </View>

      {scanErr ? (
        <View style={[styles.verdict, styles.verdictBad]}>
          <Text style={styles.verdictText}>{t('staffScan.couldNotVerify')}</Text>
          <Text style={styles.identity}>{scanErr}</Text>
        </View>
      ) : last ? (
        <View style={[styles.verdict, tone === 'ok' ? styles.verdictOk : styles.verdictBad]}>
          <Text style={styles.verdictText}>{t(V_KEY[last.verdict])}</Text>
          {last.identity && last.identity.name ? (
            <Text style={styles.identity}>
              {last.identity.name}
              {last.identity.ageBand ? ` · ${t(`ageBand.${last.identity.ageBand}`)}` : ''} ·{' '}
              {last.identity.passId}
            </Text>
          ) : null}
          {selLabel ? (
            <Text style={styles.atCheckpoint}>{t('staffScan.at', { cp: selLabel })}</Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.hint}>{t('staffScan.point')}</Text>
      )}

      {/* Manual entry — verify a pasted pass token. Lets the verdict be tested
          without a working camera (e.g. on an emulator/simulator). */}
      <View style={styles.manualWrap}>
        <Text style={styles.manualLabel}>{t('staffScan.manualLabel')}</Text>
        <View style={styles.manualRow}>
          <TextInput
            style={styles.manualInput}
            value={manual}
            onChangeText={setManual}
            placeholder={t('staffScan.manualPlaceholder')}
            placeholderTextColor={color.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          <Pressable
            style={[styles.manualBtn, !manual.trim() && { opacity: 0.5 }]}
            disabled={!manual.trim()}
            onPress={() => {
              const tk = manual.trim();
              if (tk) void onScan(tk);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('staffScan.verify')}
          >
            <Text style={styles.manualBtnText}>{t('staffScan.verify')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.foot}>{syncMsg}</Text>
        <Text style={styles.foot}>{t('staffScan.pending', { count: pending.data ?? 0 })}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  muted: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.md },
  primary: {
    marginTop: spacing.md,
    backgroundColor: palette.marigold,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...typeScale.body, color: palette.ink, fontWeight: '800' },
  sectionLabel: {
    ...typeScale.caption,
    color: color.textMuted,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  chips: { gap: spacing.sm, paddingBottom: spacing.sm, paddingRight: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.cardBorder,
    backgroundColor: '#FFFFFF',
    minHeight: MIN_TOUCH_TARGET - 8,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipText: { ...typeScale.caption, color: color.text, fontWeight: '600' },
  chipTextOn: { color: '#F6F3EC' },
  cameraWrap: {
    height: 300,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: palette.ink,
    marginTop: spacing.xs,
  },
  hint: { ...typeScale.body, color: color.textMuted, textAlign: 'center', marginTop: spacing.md },
  verdict: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: 4,
  },
  verdictOk: { backgroundColor: '#9CC5AE' },
  verdictBad: { backgroundColor: '#E7A79A' },
  verdictText: { ...typeScale.title, color: palette.ink, textAlign: 'center' },
  identity: { ...typeScale.body, color: palette.ink, fontWeight: '600', textAlign: 'center' },
  atCheckpoint: { ...typeScale.caption, color: palette.ink, opacity: 0.8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  foot: { ...typeScale.caption, color: color.textMuted },
  manualWrap: { marginTop: spacing.md, gap: spacing.xs },
  manualLabel: {
    ...typeScale.caption,
    color: palette.slate,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  manualRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  manualInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    ...typeScale.caption,
    color: color.text,
    backgroundColor: '#FFFFFF',
  },
  manualBtn: {
    backgroundColor: palette.pine,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualBtnText: { ...typeScale.body, color: '#FFFFFF', fontWeight: '600' },
});
