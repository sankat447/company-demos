import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, StyleSheet } from 'react-native';

import { Screen } from '@/ui/Screen';
import { color, spacing, typeScale } from '@/ui/tokens';

/** P4.2: my roster, QR check-in/out, incident report, certificate wallet —
 *  rendered from the SQLite roster table so it survives dead 4G. */
export default function Roster() {
  const { t } = useTranslation();
  return (
    <Screen title={t('tabs.roster')}>
      <Text style={styles.placeholder}>{t('common.offlineBanner')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  placeholder: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.lg },
});
