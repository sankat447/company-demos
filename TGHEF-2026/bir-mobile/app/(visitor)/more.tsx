import Constants from 'expo-constants';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { signOutEverywhere } from '@/auth/otp';
import { hasRole, useAuth } from '@/auth/useAuth';
import { toggleLocale } from '@/i18n';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, radius, spacing, typeScale } from '@/ui/tokens';

function Row({ label, onPress }: { label: string; onPress(): void }) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.rowText}>{label}</Text>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

export default function More() {
  const { t } = useTranslation();
  const auth = useAuth();
  const channel = (Constants.expoConfig?.extra?.APP_CHANNEL as string) ?? 'development';

  return (
    <Screen title={t('tabs.more')}>
      <Row label={t('highlights.myRegistrations')} onPress={() => router.push('/highlights/my')} />
      <Row label={t('settings.title')} onPress={() => router.push('/settings')} />
      <Row label={t('common.languageSwitch')} onPress={toggleLocale} />
      {hasRole(auth, 'volunteer') || hasRole(auth, 'organiser-lite') ? (
        <Row label={t('tabs.roster')} onPress={() => router.push('/(volunteer)/roster')} />
      ) : null}
      {hasRole(auth, 'partner') ? (
        <Row label={t('tabs.stalls')} onPress={() => router.push('/(partner)/stalls')} />
      ) : null}
      <Row
        label={t('auth.signOut')}
        onPress={() => {
          void signOutEverywhere().then(() => router.replace('/(auth)/sign-in'));
        }}
      />
      <View style={styles.meta}>
        <Text style={styles.metaText}>
          Bir Festival 2026 · v{Constants.expoConfig?.version ?? '0.0.0'} · {channel}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET + 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rowText: { ...typeScale.body, color: color.text },
  chev: { ...typeScale.heading, color: color.textMuted },
  meta: { marginTop: spacing.lg, alignItems: 'center' },
  metaText: { ...typeScale.caption, color: color.textMuted },
});
