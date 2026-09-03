import Constants from 'expo-constants';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { signOutEverywhere } from '@/auth/otp';
import { hasRole, useAuth } from '@/auth/useAuth';
import { toggleLocale } from '@/i18n';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

function Row({
  icon,
  label,
  onPress,
  danger,
  last,
}: {
  icon: string;
  label: string;
  onPress(): void;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      style={[styles.row, last && styles.rowLast]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Text style={styles.rowEmoji}>{icon}</Text>
      </View>
      <Text style={[styles.rowText, danger && styles.rowTextDanger]}>{label}</Text>
      {!danger ? <Text style={styles.chev}>›</Text> : null}
    </Pressable>
  );
}

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <View style={styles.grp}>
      {label ? <Text style={styles.grpLabel}>{label}</Text> : null}
      <View style={styles.rows}>{children}</View>
    </View>
  );
}

export default function More() {
  const { t } = useTranslation();
  const auth = useAuth();
  const channel = (Constants.expoConfig?.extra?.APP_CHANNEL as string) ?? 'development';

  const services: React.ReactNode[] = [];
  if (hasRole(auth, 'volunteer') || hasRole(auth, 'organiser-lite')) {
    services.push(
      <Row
        key="roster"
        icon="🛡️"
        label={t('tabs.roster')}
        onPress={() => router.push('/(volunteer)/roster')}
      />,
    );
  }
  if (hasRole(auth, 'partner')) {
    services.push(
      <Row
        key="stalls"
        icon="🍲"
        label={t('tabs.stalls')}
        onPress={() => router.push('/(partner)/stalls')}
      />,
    );
  }
  if (hasRole(auth, 'admin-hospitality')) {
    services.push(
      <Row
        key="lodging"
        icon="🏨"
        label={t('lodging.title')}
        onPress={() => router.push('/admin/lodging/rooms')}
      />,
    );
  }
  if (hasRole(auth, 'organiser-lite') || hasRole(auth, 'safety-officer')) {
    services.push(
      <Row key="ops" icon="📡" label={t('ops.title')} onPress={() => router.push('/admin/ops')} />,
    );
  }

  return (
    <Screen title={t('tabs.more')}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* profile header */}
        <View style={styles.who}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>बी</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.whoName}>{t('more.accountTitle')}</Text>
            <Text style={styles.whoRole}>
              {auth.demo ? t('more.demoAccess') : t('more.visitorRole')}
            </Text>
          </View>
        </View>

        {services.length ? (
          <Group label={t('more.services')}>
            {services.map((node, i) =>
              React.isValidElement(node)
                ? React.cloneElement(node, { last: i === services.length - 1 } as { last: boolean })
                : node,
            )}
          </Group>
        ) : null}

        <Group label={t('more.profile')}>
          <Row
            icon="📋"
            label={t('highlights.myRegistrations')}
            onPress={() => router.push('/highlights/my')}
            last
          />
        </Group>

        <Group label={t('more.settings')}>
          <Row icon="🔔" label={t('settings.title')} onPress={() => router.push('/settings')} />
          <Row icon="🌐" label={t('common.languageSwitch')} onPress={toggleLocale} last />
        </Group>

        <Group>
          <Row
            icon="⏻"
            label={t('auth.signOut')}
            danger
            last
            onPress={() => {
              void signOutEverywhere().then(() => router.replace('/(auth)/sign-in'));
            }}
          />
        </Group>

        <View style={styles.meta}>
          <Text style={styles.metaText}>
            Bir Festival 2026 · v{Constants.expoConfig?.version ?? '0.0.0'} · {channel}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: palette.pine,
    borderRadius: 16,
    padding: 14,
    marginBottom: 4,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: '#EAF3EC' },
  whoName: { color: '#EAF3EC', fontSize: 15, fontWeight: '700' },
  whoRole: { color: '#C6DDCB', fontSize: 12, marginTop: 2 },

  grp: { marginTop: spacing.lg },
  grpLabel: {
    ...typeScale.caption,
    color: palette.slate,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
    fontWeight: '600',
  },
  rows: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: MIN_TOUCH_TARGET + 6,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: color.cardBorder,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#F1EAD9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: '#FBEEE9' },
  rowEmoji: { fontSize: 15 },
  rowText: { ...typeScale.body, color: color.text, flex: 1 },
  rowTextDanger: { color: palette.flagRed },
  chev: { ...typeScale.heading, color: '#B7C1BA' },
  meta: { marginTop: spacing.lg, alignItems: 'center' },
  metaText: { ...typeScale.caption, color: color.textMuted },
});
