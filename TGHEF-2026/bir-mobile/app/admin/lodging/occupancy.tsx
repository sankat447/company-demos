import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { badgesPdfHtml, participantNumber } from '@/features/badges/badges';
import { issueParticipantBadge } from '@/features/badges/issue';
import { isEnabled } from '@/config/flags';
import { loadCatalog, findItem } from '@/features/highlights/catalog';
import { loadAllocation, loadPool, rosterHtml } from '@/features/lodging/allocation';
import { kvRoomStore } from '@/features/lodging/rooms';
import { LODGING_NIGHTS } from '@/features/lodging/types';
import { kvStore } from '@/offline/db';
import { Screen } from '@/ui/Screen';
import { color, palette, radius, spacing, typeScale } from '@/ui/tokens';

const roomStore = kvRoomStore(kvStore);

/**
 * P6.12 occupancy board: per-hotel rooms × nights grid, colored by fill —
 * renders offline from the cached allocation; per-hotel roster exports a
 * share-sheet PDF (names only, §5).
 */
export default function Occupancy() {
  const { t } = useTranslation();
  const rooms = useQuery({
    queryKey: ['lodging', 'rooms'],
    queryFn: () => roomStore.list(),
    networkMode: 'always',
  });
  const allocation = useQuery({
    queryKey: ['lodging', 'allocation'],
    queryFn: () => loadAllocation(kvStore),
    networkMode: 'always',
  });
  const pool = useQuery({
    queryKey: ['lodging', 'pool'],
    queryFn: loadPool,
    networkMode: 'always',
  });

  const catalog = useQuery({
    queryKey: ['highlights', 'catalog'],
    queryFn: () => loadCatalog(kvStore, Date.now()),
    networkMode: 'always',
  });

  const byId = new Map((pool.data ?? []).map((p) => [p.regId, p]));
  const hotels = [...new Set((rooms.data ?? []).map((r) => r.hotelName))].sort();
  const competitions = [...new Set((pool.data ?? []).map((p) => p.competitionId))].sort();

  const [issuing, setIssuing] = useState<string | null>(null);

  // Admin bulk issue + print (B2d). In live mode each participant gets a real
  // ES256-signed badge from the admin-guarded issueBadge mutation, and the
  // printed lanyard carries that pass jti; mock builds print a demo note only.
  const issueAndPrintBadges = async (competitionId: string) => {
    const item = catalog.data ? findItem(catalog.data, competitionId) : null;
    const participants = (pool.data ?? []).filter((p) => p.competitionId === competitionId);
    if (!participants.length) return;
    const live = !isEnabled('mockLodging');
    setIssuing(competitionId);
    try {
      const entries = await Promise.all(
        participants.map(async (p) => {
          const jti = live ? await issueParticipantBadge(p.regId).catch(() => null) : null;
          return {
            name: p.name,
            number: participantNumber(`badge-${competitionId}-${p.regId}`),
            jtiNote: jti ?? p.regId,
          };
        }),
      );
      const Print = await import('expo-print');
      const Sharing = await import('expo-sharing');
      const { uri } = await Print.printToFileAsync({
        html: badgesPdfHtml(item?.title ?? competitionId, entries),
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
      }
    } finally {
      setIssuing(null);
    }
  };

  const printRoster = async (hotelName: string) => {
    if (!allocation.data) return;
    const Print = await import('expo-print');
    const Sharing = await import('expo-sharing');
    const { uri } = await Print.printToFileAsync({
      html: rosterHtml(hotelName, rooms.data ?? [], allocation.data, pool.data ?? []),
    });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    }
  };

  return (
    <Screen title={t('lodging.occupancy')}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {hotels.map((hotelName) => {
          const hotelRooms = (rooms.data ?? [])
            .filter((r) => r.hotelName === hotelName && r.status === 'active')
            .sort((a, b) => a.roomLabel.localeCompare(b.roomLabel));
          return (
            <View key={hotelName} style={styles.hotel}>
              <View style={styles.hotelHead}>
                <Text style={styles.hotelName}>{hotelName}</Text>
                <Pressable
                  style={styles.print}
                  onPress={() => printRoster(hotelName)}
                  accessibilityRole="button"
                  accessibilityLabel={t('lodging.printRoster')}
                >
                  <Text style={styles.printText}>{t('lodging.printRoster')}</Text>
                </Pressable>
              </View>
              <View style={styles.gridHead}>
                <Text style={[styles.cellRoom, styles.gridHeadText]}>{t('lodging.rooms')}</Text>
                {LODGING_NIGHTS.map((n) => (
                  <Text key={n} style={[styles.cell, styles.gridHeadText]}>
                    {n.slice(8)}
                  </Text>
                ))}
              </View>
              {hotelRooms.map((room) => (
                <View key={room.id} style={styles.gridRow}>
                  <Text style={styles.cellRoom} numberOfLines={1}>
                    {room.roomLabel}
                  </Text>
                  {LODGING_NIGHTS.map((night) => {
                    const available = room.availability.nights.includes(night);
                    const occupants = (allocation.data?.assignments ?? []).filter((a) => {
                      const p = byId.get(a.regId);
                      return a.roomId === room.id && p?.nights.includes(night);
                    }).length;
                    const fill = !available
                      ? styles.cellNA
                      : occupants === 0
                        ? styles.cellEmpty
                        : occupants < room.capacity
                          ? styles.cellPartial
                          : styles.cellFull;
                    return (
                      <View key={night} style={[styles.cell, fill]}>
                        <Text style={styles.cellText}>
                          {available ? `${occupants}/${room.capacity}` : '—'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          );
        })}
        <View style={styles.legend}>
          <Text style={styles.legendText}>{t('lodging.legend')}</Text>
        </View>
        <Text style={styles.badgesTitle}>{t('lodging.issueBadges')}</Text>
        <Text style={styles.badgesHint}>{t('lodging.issueBadgesHint')}</Text>
        <View style={styles.badgesRow}>
          {competitions.map((competitionId) => (
            <Pressable
              key={competitionId}
              style={[styles.print, issuing === competitionId && styles.printBusy]}
              disabled={issuing !== null}
              onPress={() => issueAndPrintBadges(competitionId)}
              accessibilityRole="button"
              accessibilityLabel={`${t('lodging.issueBadges')} ${competitionId}`}
            >
              <Text style={styles.printText}>
                {issuing === competitionId ? t('lodging.issuing') : competitionId}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  hotel: { marginBottom: spacing.lg },
  hotelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  hotelName: { ...typeScale.heading, color: color.text },
  print: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.info,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printBusy: { opacity: 0.5 },
  printText: { fontSize: 12, color: color.info, fontWeight: '600' },
  gridHead: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  gridHeadText: { fontSize: 10, color: color.textMuted, fontWeight: '700', textAlign: 'center' },
  gridRow: { flexDirection: 'row', gap: 4, marginBottom: 4, alignItems: 'center' },
  cellRoom: { width: 96, fontSize: 11, color: color.text, fontWeight: '600' },
  cell: {
    flex: 1,
    minHeight: 30,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: { fontSize: 10.5, color: color.text, fontWeight: '600' },
  cellNA: { backgroundColor: '#ECEFF1' },
  cellEmpty: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: color.cardBorder },
  cellPartial: { backgroundColor: '#F2C98A' },
  cellFull: { backgroundColor: '#9CC5AE' },
  legend: { marginTop: spacing.sm },
  badgesTitle: {
    ...typeScale.heading,
    color: color.text,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  badgesHint: { ...typeScale.caption, color: color.textMuted, marginBottom: spacing.xs },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  legendText: { ...typeScale.caption, color: color.textMuted },
});
