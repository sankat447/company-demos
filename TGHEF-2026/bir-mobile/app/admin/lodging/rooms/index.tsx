import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { kvRoomStore } from '@/features/lodging/rooms';
import type { RoomStatus } from '@/features/lodging/types';
import { kvStore } from '@/offline/db';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const store = kvRoomStore(kvStore);
const FILTERS: (RoomStatus | 'all')[] = ['all', 'active', 'held', 'retired'];

/** Room inventory list + filters (P6.10). */
export default function Rooms() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<RoomStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const rooms = useQuery({
    queryKey: ['lodging', 'rooms'],
    queryFn: () => store.list(),
    networkMode: 'always',
  });

  const visible = (rooms.data ?? [])
    .filter((r) => filter === 'all' || r.status === filter)
    .filter((r) => r.hotelName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => `${a.hotelName}${a.roomLabel}`.localeCompare(`${b.hotelName}${b.roomLabel}`));

  return (
    <Screen title={t('lodging.rooms')}>
      <Pressable
        style={styles.add}
        onPress={() => router.push('/admin/lodging/rooms/new')}
        accessibilityRole="button"
        accessibilityLabel={t('lodging.addRoom')}
      >
        <Text style={styles.addText}>{t('lodging.addRoom')}</Text>
      </Pressable>
      <View style={styles.navRow}>
        <Pressable
          style={styles.navBtn}
          onPress={() => router.push('/admin/lodging/allocate')}
          accessibilityRole="button"
          accessibilityLabel={t('lodging.allocate')}
        >
          <Text style={styles.navBtnText}>{t('lodging.allocate')}</Text>
        </Pressable>
        <Pressable
          style={styles.navBtn}
          onPress={() => router.push('/admin/lodging/occupancy')}
          accessibilityRole="button"
          accessibilityLabel={t('lodging.occupancy')}
        >
          <Text style={styles.navBtnText}>{t('lodging.occupancy')}</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder={t('lodging.searchHotel')}
        placeholderTextColor={color.textMuted}
        accessibilityLabel={t('lodging.searchHotel')}
      />
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            style={[styles.filter, filter === f && styles.filterOn]}
            onPress={() => setFilter(f)}
            accessibilityRole="button"
            accessibilityLabel={t(`lodging.filter_${f}`)}
            accessibilityState={{ selected: filter === f }}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextOn]}>
              {t(`lodging.filter_${f}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={visible}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={<Text style={styles.empty}>{t('lodging.noRooms')}</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() =>
              router.push({ pathname: '/admin/lodging/rooms/[id]', params: { id: item.id } })
            }
            accessibilityRole="button"
            accessibilityLabel={`${item.hotelName} ${item.roomLabel}`}
          >
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>
                {item.hotelName} · {item.roomLabel}
              </Text>
              <View style={[styles.status, item.status !== 'active' && styles.statusOff]}>
                <Text style={styles.statusText}>{t(`lodging.filter_${item.status}`)}</Text>
              </View>
            </View>
            <Text style={styles.cardMeta}>
              {t(`lodging.type_${item.type}`)} · {t('lodging.beds', { n: item.capacity })}
              {item.doubleOccupancy ? ` · ${t('lodging.couplesEligible')}` : ''}
              {item.propertyId ? ` · ${t('lodging.partnerSourced')}` : ''}
            </Text>
            <Text style={styles.cardNights}>
              {item.availability.nights.map((n) => n.slice(8)).join(' · ')} Nov
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  add: {
    backgroundColor: palette.ink,
    borderColor: palette.marigold,
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  addText: { ...typeScale.body, color: palette.marigold, fontWeight: '700' },
  navRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  navBtn: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.pine,
    backgroundColor: '#FFFFFF',
  },
  navBtnText: { ...typeScale.body, color: palette.pine, fontWeight: '600' },
  search: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    ...typeScale.body,
    color: color.text,
    backgroundColor: '#FFFFFF',
    marginBottom: spacing.sm,
  },
  filters: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  filter: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  filterOn: { backgroundColor: color.primary, borderColor: color.primary },
  filterText: { fontSize: 11.5, color: color.text },
  filterTextOn: { color: color.textInverse, fontWeight: '600' },
  empty: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.lg },
  card: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: '#FFFFFF',
    gap: 3,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { ...typeScale.heading, color: color.text, flex: 1, fontSize: 15 },
  status: {
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    backgroundColor: '#E4EEE8',
  },
  statusOff: { backgroundColor: '#ECEFF1' },
  statusText: { fontSize: 10, fontWeight: '700', color: color.text },
  cardMeta: { ...typeScale.caption, color: color.textMuted },
  cardNights: { ...typeScale.caption, color: palette.pine, fontWeight: '600' },
});
