import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getLocationOnce, triggerSos } from '@/features/sos/sos';
import { loadRoster } from '@/features/volunteers/roster';
import { markAttendance, recordedAttendance, type Shift } from '@/features/volunteers/volunteer';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const outbox = new SqliteOutboxStore();

/**
 * P4.2 volunteer roster: my shifts, self QR check-in/out (outbox-safe),
 * incident report entry, certificate wallet link. Renders offline from cache.
 */
export default function Roster() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const roster = useQuery({
    queryKey: ['volunteer', 'roster'],
    queryFn: loadRoster,
    networkMode: 'always',
  });
  const attendance = useQuery({
    queryKey: ['volunteer', 'attendance'],
    queryFn: () => recordedAttendance(kvStore),
    networkMode: 'always',
  });

  const marked = (shiftId: string, kind: 'check-in' | 'check-out') =>
    (attendance.data ?? []).some((m) => m.shiftId === shiftId && m.kind === kind);

  const mark = async (shift: Shift, kind: 'check-in' | 'check-out') => {
    const session = await fetchAuthSession().catch(() => null);
    const sub = String(session?.tokens?.idToken?.payload?.sub ?? 'demo-user');
    await markAttendance({ kv: kvStore, outbox }, { sub, shiftId: shift.id, kind }, Date.now());
    await queryClient.invalidateQueries({ queryKey: ['volunteer', 'attendance'] });
  };

  const sos = async () => {
    const session = await fetchAuthSession().catch(() => null);
    const sub = String(session?.tokens?.idToken?.payload?.sub ?? 'anonymous');
    await triggerSos(
      { outbox, openUrl: (url) => Linking.openURL(url), getLocation: getLocationOnce },
      { sub, nowMs: Date.now() },
    );
  };

  const profile = roster.data;

  return (
    <Screen title={t('tabs.roster')}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {profile ? (
          <>
            <View style={styles.header}>
              <Text style={styles.team}>{profile.team}</Text>
              <View style={[styles.idChip, profile.idVerified ? styles.idOk : styles.idPending]}>
                <Text style={styles.idText}>
                  {profile.idVerified ? t('volunteer.idVerified') : t('volunteer.idPending')}
                </Text>
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable
                style={styles.action}
                onPress={() => router.push('/(volunteer)/scanner')}
                accessibilityRole="button"
                accessibilityLabel={t('volunteer.openScanner')}
              >
                <Text style={styles.actionText}>{t('volunteer.openScanner')}</Text>
              </Pressable>
              <Pressable
                style={styles.action}
                onPress={() => router.push('/(volunteer)/incident')}
                accessibilityRole="button"
                accessibilityLabel={t('volunteer.reportIncident')}
              >
                <Text style={styles.actionText}>{t('volunteer.reportIncident')}</Text>
              </Pressable>
              <Pressable
                style={[styles.action, styles.sosAction]}
                onPress={sos}
                accessibilityRole="button"
                accessibilityLabel={t('home.sos')}
              >
                <Text style={styles.sosText}>{t('home.sos')}</Text>
              </Pressable>
            </View>

            {profile.certificateJti ? (
              <Pressable
                style={styles.certLink}
                onPress={() =>
                  router.push({ pathname: '/pass/[jti]', params: { jti: profile.certificateJti! } })
                }
                accessibilityRole="button"
                accessibilityLabel={t('volunteer.certificate')}
              >
                <Text style={styles.certText}>{t('volunteer.certificate')} ›</Text>
              </Pressable>
            ) : (
              <Text style={styles.certPending}>{t('volunteer.certificatePending')}</Text>
            )}

            <Text style={styles.sectionTitle}>{t('volunteer.myShifts')}</Text>
            {profile.shifts.map((shift) => {
              const inDone = marked(shift.id, 'check-in');
              const outDone = marked(shift.id, 'check-out');
              return (
                <View key={shift.id} style={styles.shift}>
                  <Text style={styles.shiftRole}>{shift.role}</Text>
                  <Text style={styles.shiftMeta}>
                    {shift.date.slice(8)} Nov · {shift.zone} ·{' '}
                    {new Date(shift.startsAtSec * 1000).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    –
                    {new Date(shift.endsAtSec * 1000).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                  <View style={styles.shiftBtns}>
                    <Pressable
                      style={[styles.shiftBtn, inDone && styles.shiftBtnDone]}
                      disabled={inDone}
                      onPress={() => mark(shift, 'check-in')}
                      accessibilityRole="button"
                      accessibilityLabel={t('volunteer.checkIn')}
                    >
                      <Text style={styles.shiftBtnText}>
                        {inDone ? t('volunteer.checkedIn') : t('volunteer.checkIn')}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.shiftBtn, (!inDone || outDone) && styles.shiftBtnDone]}
                      disabled={!inDone || outDone}
                      onPress={() => mark(shift, 'check-out')}
                      accessibilityRole="button"
                      accessibilityLabel={t('volunteer.checkOut')}
                    >
                      <Text style={styles.shiftBtnText}>
                        {outDone ? t('volunteer.checkedOut') : t('volunteer.checkOut')}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </>
        ) : (
          <Text style={styles.muted}>{t('common.offlineBanner')}</Text>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  team: { ...typeScale.heading, color: color.text, flex: 1 },
  idChip: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  idOk: { backgroundColor: '#E4EEE8' },
  idPending: { backgroundColor: '#FCF3E3' },
  idText: { fontSize: 10.5, fontWeight: '700', color: color.text },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: palette.ink,
    borderWidth: 1,
    borderColor: palette.marigold,
  },
  actionText: { ...typeScale.body, color: palette.marigold, fontWeight: '600' },
  sosAction: { backgroundColor: '#F7E7E0', borderColor: palette.flagRed },
  sosText: { ...typeScale.body, color: palette.flagRed, fontWeight: '800' },
  certLink: { marginTop: spacing.md, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  certText: { ...typeScale.body, color: color.info, fontWeight: '600' },
  certPending: { ...typeScale.caption, color: color.textMuted, marginTop: spacing.md },
  sectionTitle: {
    ...typeScale.heading,
    color: color.text,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  shift: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: '#FFFFFF',
    gap: 4,
  },
  shiftRole: { ...typeScale.body, color: color.text, fontWeight: '600' },
  shiftMeta: { ...typeScale.caption, color: color.textMuted },
  shiftBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  shiftBtn: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.primary,
    backgroundColor: '#FFFFFF',
  },
  shiftBtnDone: { opacity: 0.5, backgroundColor: '#F0F4EF' },
  shiftBtnText: { ...typeScale.caption, color: color.primary, fontWeight: '600' },
  muted: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.md },
});
