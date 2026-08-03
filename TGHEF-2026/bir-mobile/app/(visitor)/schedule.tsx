import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, StyleSheet } from 'react-native';

import { Screen } from '@/ui/Screen';
import { color, spacing, typeScale } from '@/ui/tokens';

/** P3.2 fills this with day tabs + venue pins + reminders, rendered from the
 *  SQLite schedule table (delta-synced) so it works offline. */
export default function Schedule() {
  const { t } = useTranslation();
  return (
    <Screen title={t('tabs.schedule')}>
      <Text style={styles.placeholder}>{t('common.offlineBanner')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  placeholder: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.lg },
});
