import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, StyleSheet } from 'react-native';

import { Screen } from '@/ui/Screen';
import { color, spacing, typeScale } from '@/ui/tokens';

/** P5.3: allocations, check-in flow, occupancy board (offline-render from cache). */
export default function Hospitality() {
  const { t } = useTranslation();
  return (
    <Screen title={t('tabs.hospitality')}>
      <Text style={styles.placeholder}>{t('common.offlineBanner')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  placeholder: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.lg },
});
