import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import {
  toggleReminder,
  expoNotifier,
  remindedEventIds,
} from '@/features/cultural-nights/reminders';
import {
  FESTIVAL_DAYS,
  listEventsForDay,
  type FestivalDay,
  type ScheduleEvent,
} from '@/features/cultural-nights/schedule';
import { castVote, votedEventIds } from '@/features/cultural-nights/votes';
import { fetchVenues } from '@/features/cultural-nights/venues';
import { mapsEnabled } from '@/config/flags';
import { currentLocale } from '@/i18n';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { pullScheduleDelta } from '@/offline/sync';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const outbox = new SqliteOutboxStore();
const notifier = expoNotifier();
const DAY_KEY: Record<FestivalDay, string> = {
  '2026-11-21': 'schedule.day1',
  '2026-11-22': 'schedule.day2',
  '2026-11-23': 'schedule.day3',
};

function formatTime(sec?: number | null): string {
  if (!sec) return '';
  return new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * P3.2 — Daily Cultural Nights: day tabs, venue pins, local-notification
 * reminders, and outbox-safe audience-favourite voting. Everything renders
 * from the delta-synced SQLite cache; votes queue offline.
 */
export default function Schedule() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [day, setDay] = useState<FestivalDay>(FESTIVAL_DAYS[0]);

  const events = useQuery({
    queryKey: ['schedule', day],
    // Pull the latest schedule from AppSync into SQLite, then read it back. The
    // delta is idempotent (upsert) and offline-tolerant, so a failed pull just
    // falls back to whatever is already cached locally.
    queryFn: async () => {
      await pullScheduleDelta(Date.now()).catch(() => {});
      return listEventsForDay(day);
    },
    networkMode: 'always',
  });
  const voted = useQuery({
    queryKey: ['votes', 'cast'],
    queryFn: () => votedEventIds(kvStore),
    networkMode: 'always',
  });
  const reminded = useQuery({
    queryKey: ['reminders'],
    queryFn: () => remindedEventIds(kvStore),
    networkMode: 'always',
  });
  const venues = useQuery({
    queryKey: ['venues'],
    queryFn: () => fetchVenues(kvStore, Date.now()),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const onVote = async (event: ScheduleEvent) => {
    const session = await fetchAuthSession();
    const sub = String(session.tokens?.idToken?.payload?.sub ?? '');
    if (!sub) return;
    await castVote(
      { outbox, kv: kvStore },
      { sub, eventId: event.id, category: event.category },
      Date.now(),
    );
    await queryClient.invalidateQueries({ queryKey: ['votes', 'cast'] });
  };

  const onRemind = async (event: ScheduleEvent) => {
    const title = titleFor(event);
    await toggleReminder(
      kvStore,
      event,
      { title, body: event.venue ?? t('app.name') },
      Date.now(),
      notifier,
    );
    await queryClient.invalidateQueries({ queryKey: ['reminders'] });
  };

  const titleFor = (event: ScheduleEvent) =>
    (currentLocale() === 'hi' && event.titleHi ? event.titleHi : event.titleEn) ?? event.id;

  return (
    <Screen title={t('schedule.title')}>
      <View style={styles.tabs}>
        {FESTIVAL_DAYS.map((d) => (
          <Pressable
            key={d}
            style={[styles.tab, day === d && styles.tabActive]}
            onPress={() => setDay(d)}
            accessibilityRole="tab"
            accessibilityLabel={t(DAY_KEY[d])}
            accessibilityState={{ selected: day === d }}
          >
            <Text style={[styles.tabText, day === d && styles.tabTextActive]}>{t(DAY_KEY[d])}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={events.data ?? []}
        keyExtractor={(e) => e.id}
        ListEmptyComponent={<Text style={styles.empty}>{t('schedule.empty')}</Text>}
        ListFooterComponent={
          venues.data && venues.data.length > 0 ? (
            <View style={styles.mapWrap}>
              <Text style={styles.mapTitle}>{t('schedule.venuesMap')}</Text>
              {mapsEnabled() ? (
                <MapView
                  style={styles.map}
                  initialRegion={{
                    latitude: venues.data[0].lat,
                    longitude: venues.data[0].lng,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                  }}
                >
                  {venues.data.map((v) => (
                    <Marker
                      key={v.id}
                      coordinate={{ latitude: v.lat, longitude: v.lng }}
                      title={currentLocale() === 'hi' && v.nameHi ? v.nameHi : v.nameEn}
                    />
                  ))}
                </MapView>
              ) : (
                // No Google Maps key baked in — list the venues instead of a
                // native map (which would crash on init). Flips to the map the
                // moment a key is provided at build (see mapsEnabled()).
                <View style={styles.venueList}>
                  {venues.data.map((v) => (
                    <View key={v.id} style={styles.venueRow}>
                      <Text style={styles.venuePin}>📍</Text>
                      <Text style={styles.venueName}>
                        {currentLocale() === 'hi' && v.nameHi ? v.nameHi : v.nameEn}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const hasVoted = Boolean(voted.data?.[item.id]);
          const hasReminder = reminded.data?.has(item.id) ?? false;
          return (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{titleFor(item)}</Text>
              <Text style={styles.cardMeta}>
                {item.startsAtSec
                  ? t('schedule.timeRange', {
                      start: formatTime(item.startsAtSec),
                      end: formatTime(item.endsAtSec),
                    })
                  : ''}
                {item.venue ? ` · ${item.venue}` : ''}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  style={[styles.action, hasReminder && styles.actionOn]}
                  onPress={() => onRemind(item)}
                  accessibilityRole="button"
                  accessibilityLabel={hasReminder ? t('schedule.reminded') : t('schedule.remind')}
                >
                  <Text style={styles.actionText}>
                    {hasReminder ? t('schedule.reminded') : t('schedule.remind')}
                  </Text>
                </Pressable>
                {item.votable ? (
                  <Pressable
                    style={[styles.action, styles.voteAction, hasVoted && styles.actionOn]}
                    onPress={() => onVote(item)}
                    disabled={hasVoted}
                    accessibilityRole="button"
                    accessibilityLabel={hasVoted ? t('schedule.voted') : t('schedule.vote')}
                  >
                    <Text style={styles.actionText}>
                      {hasVoted ? t('schedule.voted') : t('schedule.vote')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {item.votable && !hasVoted ? (
                <Text style={styles.voteHint}>{t('schedule.voteHint')}</Text>
              ) : null}
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  tab: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  tabActive: { backgroundColor: color.primary, borderColor: color.primary },
  tabText: { ...typeScale.body, color: color.text },
  tabTextActive: { color: color.textInverse, fontWeight: '600' },
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
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.info,
  },
  voteAction: { borderColor: palette.marigold },
  actionOn: { backgroundColor: '#F0F4EF' },
  actionText: { ...typeScale.body, color: color.text },
  voteHint: { ...typeScale.caption, color: color.textMuted, marginTop: spacing.xs },
  mapWrap: { marginTop: spacing.md, marginBottom: spacing.xl, gap: spacing.sm },
  mapTitle: { ...typeScale.heading, color: color.text },
  map: { height: 180, borderRadius: radius.lg },
  venueList: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.cardBorder,
    paddingVertical: spacing.xs,
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  venuePin: { fontSize: 16 },
  venueName: { ...typeScale.body, color: color.text },
});
