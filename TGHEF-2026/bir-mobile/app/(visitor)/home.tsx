import Constants from 'expo-constants';
import { Link } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { hasRole, useAuth } from '@/auth/useAuth';
import { Screen } from '@/ui/Screen';
import { color, radius, spacing, typeScale } from '@/ui/tokens';

export default function Home() {
  const { t } = useTranslation();
  const auth = useAuth();
  const channel = (Constants.expoConfig?.extra?.APP_CHANNEL as string) ?? 'development';

  return (
    <Screen title={t('home.todayAtFestival')}>
      {channel === 'direct' ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{t('common.directChannelNotice')}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardText}>{t('tickets.empty')}</Text>
      </View>

      {hasRole(auth, 'volunteer') ? (
        <Link href="/(volunteer)/roster" style={styles.roleLink}>
          <Text style={styles.roleLinkText}>{t('tabs.roster')} →</Text>
        </Link>
      ) : null}
      {hasRole(auth, 'partner') ? (
        <Link href="/(partner)/stalls" style={styles.roleLink}>
          <Text style={styles.roleLinkText}>{t('tabs.stalls')} →</Text>
        </Link>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: '#FCF3E3',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: { ...typeScale.caption, color: color.text },
  card: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.lg,
    padding: spacing.lg,
    backgroundColor: '#FFFFFF',
  },
  cardText: { ...typeScale.body, color: color.textMuted },
  roleLink: { marginTop: spacing.md },
  roleLinkText: { ...typeScale.body, color: color.info, fontWeight: '600' },
});
