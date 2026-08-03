import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, StyleSheet } from 'react-native';

import { Screen } from '@/ui/Screen';
import { color, spacing, typeScale } from '@/ui/tokens';

/** P5.2: stall console — application status (read-only Step Functions mirror),
 *  payments, daily analytics cards. */
export default function Stalls() {
  const { t } = useTranslation();
  return (
    <Screen title={t('tabs.stalls')}>
      <Text style={styles.placeholder}>{t('common.loading')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  placeholder: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.lg },
});
