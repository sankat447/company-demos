import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { listPasses } from '@/features/tickets/passStore';
import { resumePendingOrders } from '@/features/tickets/purchase';
import { kvStore } from '@/offline/db';
import { ensureFreshJwks } from '@/offline/jwks';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, radius, spacing, typeScale } from '@/ui/tokens';

const TYPE_KEY: Record<string, string> = {
  ticket: 'tickets.typeTicket',
  volunteer: 'tickets.typeVolunteer',
  'volunteer-attendance': 'tickets.typeVolunteerAttendance',
  'seat-entry': 'tickets.typeSeatEntry',
  stall: 'tickets.typeStall',
  room: 'tickets.typeRoom',
  activity: 'tickets.typeActivity',
};

export default function Tickets() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // SQLite is the source of truth here — renders identically offline.
  const passes = useQuery({ queryKey: ['passes'], queryFn: listPasses, networkMode: 'always' });

  // Kill-app-between-pay-and-confirm recovery: reconcile any orders left
  // pending, then refresh the wallet if passes arrived.
  useEffect(() => {
    void (async () => {
      try {
        const jwks = await ensureFreshJwks(kvStore, Date.now());
        const ingested = await resumePendingOrders(kvStore, jwks, Math.floor(Date.now() / 1000));
        if (ingested > 0) await queryClient.invalidateQueries({ queryKey: ['passes'] });
      } catch {
        // Offline or backend unreachable — recovery retries on next mount.
      }
    })();
  }, [queryClient]);

  return (
    <Screen title={t('tickets.myPasses')}>
      <Pressable
        style={styles.bookButton}
        onPress={() => router.push('/buy')}
        accessibilityRole="button"
        accessibilityLabel={t('tickets.bookTicket')}
      >
        <Text style={styles.bookText}>{t('tickets.bookTicket')}</Text>
      </Pressable>
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
  bookButton: {
    backgroundColor: color.primary,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  bookText: { ...typeScale.body, color: color.textInverse, fontWeight: '600' },
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
