import { useQuery } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { adminLogout, getAdminSession } from '@/auth/adminAuth';
import { clearMode } from '@/mode/mode';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

/**
 * Staff home (Phase 1 shell). Phase 2 adds the camera scanner + the tier-gated
 * admin dashboards. For now it confirms the signed-in coordinator/admin and
 * offers sign-out + switch-mode.
 */
export default function StaffHome() {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useQuery({
    queryKey: ['adminSession'],
    queryFn: getAdminSession,
    networkMode: 'always',
  });

  if (session.isLoading) {
    return (
      <Screen title={t('staff.home')}>
        <View style={styles.center}>
          <ParagliderSpinner />
        </View>
      </Screen>
    );
  }
  if (!session.data) return <Redirect href="/(staff)/sign-in" />;
  const s = session.data;

  const signOut = async () => {
    await adminLogout();
    router.replace('/(staff)/sign-in');
  };
  const switchMode = async () => {
    await clearMode();
    router.replace('/');
  };

  return (
    <Screen title={t('staff.home')}>
      <ScrollView contentContainerStyle={styles.stack} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.hi}>{t('staff.welcome', { name: s.name })}</Text>
          <View style={styles.tierRow}>
            <Text style={[styles.tierBadge, styles[`t${s.tier}` as 't1']]}>T{s.tier}</Text>
            <Text style={styles.tierName}>{s.tierName}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardIcon}>📷</Text>
          <Text style={styles.cardTitle}>{t('staff.scanner')}</Text>
          <Text style={styles.cardDesc}>{t('staff.scannerSoon')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardIcon}>📊</Text>
          <Text style={styles.cardTitle}>{t('staff.dashboards')}</Text>
          <Text style={styles.cardDesc}>{t('staff.dashboardsSoon')}</Text>
        </View>

        <Pressable style={styles.ghost} onPress={switchMode} accessibilityRole="button">
          <Text style={styles.ghostText}>{t('staff.switchMode')}</Text>
        </Pressable>
        <Pressable style={styles.ghost} onPress={signOut} accessibilityRole="button">
          <Text style={styles.ghostText}>{t('staff.signOut')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  stack: { gap: spacing.md, paddingBottom: spacing.xl },
  hero: { gap: spacing.sm },
  hi: { ...typeScale.title, color: color.text },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tierBadge: {
    ...typeScale.caption,
    fontWeight: '800',
    color: palette.ink,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  t1: { backgroundColor: palette.marigold },
  t2: { backgroundColor: palette.pine, color: '#fff' },
  t3: { backgroundColor: palette.slate, color: '#fff' },
  t4: { backgroundColor: '#8A938E', color: '#fff' },
  tierName: { ...typeScale.body, color: color.textMuted },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardIcon: { fontSize: 26 },
  cardTitle: { ...typeScale.heading, color: color.text },
  cardDesc: { ...typeScale.caption, color: color.textMuted },
  ghost: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
  },
  ghostText: { ...typeScale.body, color: color.text, fontWeight: '600' },
});
