import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, StyleSheet } from 'react-native';

import { Screen } from '@/ui/Screen';
import { color, spacing, typeScale } from '@/ui/tokens';

/** P6.1 wires this to ai.assistantPath via src/api/sse.ts (streamed tokens,
 *  hi/en by locale, FAQ cache offline, human handoff deep link). */
export default function Assistant() {
  const { t } = useTranslation();
  return (
    <Screen title={t('assistant.title')}>
      <Text style={styles.placeholder}>{t('assistant.placeholder')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  placeholder: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.lg },
});
