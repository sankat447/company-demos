import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { hasRole, useAuth } from '@/auth/useAuth';
import { getFlyStatus, type FlyState } from '@/features/flight-status/flyStatus';
import { declareFlyStatus } from '@/features/flight-status/setFlyStatus';
import { queueRevokePass } from '@/features/scanner/revokePass';
import { SqliteScanStore } from '@/features/scanner/scanStore';
import { loadAllocation } from '@/features/lodging/allocation';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const outbox = new SqliteOutboxStore();
const scans = new SqliteScanStore();

const STATES: { state: FlyState; tone: string }[] = [
  { state: 'flying', tone: '#9CC5AE' },
  { state: 'hold', tone: '#F2C98A' },
  { state: 'closed', tone: '#E7A79A' },
];

/**
 * Organiser-lite / Safety-officer control (closes two analysis gaps):
 *   • Safety officer DECLARES fly-status → backend fans out to all devices.
 *   • Organiser sees a live local ops snapshot (scans/queued/allocation).
 * The declaration is privileged: server re-checks the role + audit-logs.
 */
export default function Ops() {
  const { t } = useTranslation();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [reasonEn, setReasonEn] = useState('');
  const [reasonHi, setReasonHi] = useState('');
  const [declared, setDeclared] = useState<FlyState | null>(null);
  const [revokeJti, setRevokeJti] = useState('');
  const [revoked, setRevoked] = useState<string | null>(null);

  const canSafety = hasRole(auth, 'safety-officer');
  const canOps = hasRole(auth, 'organiser-lite') || canSafety;

  const fly = useQuery({
    queryKey: ['flyStatus'],
    queryFn: () => getFlyStatus(kvStore),
    networkMode: 'always',
  });
  const pendingScans = useQuery({
    queryKey: ['scans', 'pending'],
    queryFn: () => scans.pendingCount(),
    networkMode: 'always',
  });
  const queued = useQuery({
    queryKey: ['outbox', 'count'],
    queryFn: () => outbox.pendingCount(),
    refetchInterval: 5000,
    networkMode: 'always',
  });
  const alloc = useQuery({
    queryKey: ['lodging', 'allocation'],
    queryFn: () => loadAllocation(kvStore),
    networkMode: 'always',
  });

  if (auth.status === 'signedOut') return <Redirect href="/(auth)/sign-in" />;
  if (!canOps) return <Redirect href="/(visitor)/home" />;

  const declare = async (state: FlyState) => {
    const session = await fetchAuthSession().catch(() => null);
    const sub = String(session?.tokens?.idToken?.payload?.sub ?? 'demo-safety');
    await declareFlyStatus(outbox, { sub, state, reasonEn, reasonHi }, Date.now());
    setDeclared(state);
    await queryClient.invalidateQueries({ queryKey: ['outbox', 'count'] });
  };

  const revoke = async () => {
    const jti = revokeJti.trim();
    if (!jti) return;
    await queueRevokePass(outbox, jti, Date.now());
    setRevoked(jti);
    setRevokeJti('');
    await queryClient.invalidateQueries({ queryKey: ['outbox', 'count'] });
  };

  return (
    <Screen title={t('ops.title')}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>{t('ops.snapshot')}</Text>
        <View style={styles.grid}>
          <Stat
            label={t('ops.currentFly')}
            value={fly.data ? t(`home.flyChip${cap(fly.data.state)}`) : '—'}
          />
          <Stat label={t('ops.unsyncedScans')} value={String(pendingScans.data ?? 0)} />
          <Stat label={t('ops.queuedWrites')} value={String(queued.data ?? 0)} />
          <Stat
            label={t('ops.lodgingVersion')}
            value={alloc.data ? `v${alloc.data.version}` : '—'}
          />
        </View>

        {canSafety ? (
          <>
            <Text style={styles.sectionTitle}>{t('ops.declareFly')}</Text>
            <Text style={styles.warn}>{t('ops.declareWarn')}</Text>
            <TextInput
              style={styles.input}
              value={reasonEn}
              onChangeText={setReasonEn}
              placeholder={t('ops.reasonEn')}
              placeholderTextColor={color.textMuted}
              accessibilityLabel={t('ops.reasonEn')}
            />
            <TextInput
              style={styles.input}
              value={reasonHi}
              onChangeText={setReasonHi}
              placeholder={t('ops.reasonHi')}
              placeholderTextColor={color.textMuted}
              accessibilityLabel={t('ops.reasonHi')}
            />
            <View style={styles.stateRow}>
              {STATES.map(({ state, tone }) => (
                <Pressable
                  key={state}
                  style={[styles.stateBtn, { backgroundColor: tone }]}
                  onPress={() => declare(state)}
                  accessibilityRole="button"
                  accessibilityLabel={t(`ops.set_${state}`)}
                >
                  <Text style={styles.stateText}>{t(`ops.set_${state}`)}</Text>
                </Pressable>
              ))}
            </View>
            {declared ? (
              <Text style={styles.done}>
                {t('ops.declared', { state: t(`ops.set_${declared}`) })}
              </Text>
            ) : null}
          </>
        ) : null}

        <Text style={styles.sectionTitle}>{t('ops.revokeTitle')}</Text>
        <Text style={styles.warn}>{t('ops.revokeWarn')}</Text>
        <TextInput
          style={styles.input}
          value={revokeJti}
          onChangeText={setRevokeJti}
          placeholder={t('ops.revokeJtiPlaceholder')}
          placeholderTextColor={color.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('ops.revokeJtiPlaceholder')}
        />
        <Pressable
          style={[styles.revokeBtn, !revokeJti.trim() && styles.revokeBtnDisabled]}
          onPress={revoke}
          disabled={!revokeJti.trim()}
          accessibilityRole="button"
          accessibilityLabel={t('ops.revokeBtn')}
        >
          <Text style={styles.revokeText}>{t('ops.revokeBtn')}</Text>
        </Pressable>
        {revoked ? <Text style={styles.done}>{t('ops.revoked', { jti: revoked })}</Text> : null}
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  sectionTitle: {
    ...typeScale.heading,
    color: color.text,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statLabel: {
    fontSize: 10.5,
    color: color.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statValue: { ...typeScale.title, color: palette.pine, marginTop: 2 },
  warn: { ...typeScale.caption, color: palette.flagRed, marginBottom: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    ...typeScale.body,
    color: color.text,
    backgroundColor: '#FFFFFF',
    marginBottom: spacing.sm,
  },
  stateRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  stateBtn: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET + 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  stateText: { ...typeScale.body, color: palette.ink, fontWeight: '800' },
  revokeBtn: {
    minHeight: MIN_TOUCH_TARGET + 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: palette.flagRed,
    marginTop: spacing.xs,
  },
  revokeBtnDisabled: { opacity: 0.4 },
  revokeText: { ...typeScale.body, color: '#FFFFFF', fontWeight: '800' },
  done: { ...typeScale.caption, color: color.success, marginTop: spacing.sm, textAlign: 'center' },
});
