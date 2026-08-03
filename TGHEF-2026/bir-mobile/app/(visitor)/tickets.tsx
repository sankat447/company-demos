import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { listPasses } from '@/features/tickets/passStore';
import { Screen } from '@/ui/Screen';
import { color, radius, spacing, typeScale } from '@/ui/tokens';

const TYPE_KEY: Record<string, string> = {
  ticket: 'tickets.typeTicket',
  volunteer: 'tickets.typeVolunteer',
  stall: 'tickets.typeStall',
  room: 'tickets.typeRoom',
};

export default function Tickets() {
  const { t } = useTranslation();
  // SQLite is the source of truth here — renders identically offline.
  const passes = useQuery({ queryKey: ['passes'], queryFn: listPasses, networkMode: 'always' });

  return (
    <Screen title={t('tickets.myPasses')}>
      <FlatList
        data={passes.data ?? []}
        keyExtractor={(p) => p.jti}
        ListEmptyComponent={<Text style={styles.empty}>{t('tickets.empty')}</Text>}
        renderItem={({ item }) => (
          <Link href={{ pathname: '/pass/[jti]', params: { jti: item.jti } }} asChild>
            <View style={styles.card} accessibilityRole="button">
              <Text style={styles.cardTitle}>{t(TYPE_KEY[item.typ] ?? 'tickets.typeTicket')}</Text>
              <Text style={styles.cardMeta}>{item.claims.evt}</Text>
              <Text style={styles.offline}>{t('tickets.worksOffline')}</Text>
            </View>
          </Link>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.xl },
  card: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: '#FFFFFF',
    gap: spacing.xs,
  },
  cardTitle: { ...typeScale.heading, color: color.text },
  cardMeta: { ...typeScale.caption, color: color.textMuted },
  offline: { ...typeScale.caption, color: color.success },
});
