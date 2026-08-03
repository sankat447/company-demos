import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { Screen } from '@/ui/Screen';
import { color, radius, spacing, typeScale } from '@/ui/tokens';

const outbox = new SqliteOutboxStore();

/**
 * P4.1 adds react-native-vision-camera + frame processor here (dependency is
 * deferred to that PR per bundle-discipline rule 7). The verdict pipeline it
 * will call — evaluateScan() + scan recording + outbox drain — already exists
 * in src/features/scanner/verdict.ts and src/offline/.
 */
export default function Scanner() {
  const { t } = useTranslation();
  const pending = useQuery({
    queryKey: ['outbox', 'pending'],
    queryFn: () => outbox.pendingCount(),
    refetchInterval: 5_000,
    networkMode: 'always',
  });

  return (
    <Screen title={t('scanner.title')}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>
          {t('scanner.pendingSync', { count: pending.data ?? 0 })}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: color.bgDark,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  badgeText: { ...typeScale.caption, color: color.textInverse },
});
