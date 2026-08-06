import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import Constants from 'expo-constants';
import { Link } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { hasRole, useAuth } from '@/auth/useAuth';
import { festivalDayFor, listEventsForDay } from '@/features/cultural-nights/schedule';
import {
  getFlyStatus,
  subscribeFlyStatus,
  type FlyStatus,
} from '@/features/flight-status/flyStatus';
import { getLocationOnce, triggerSos } from '@/features/sos/sos';
import { currentLocale } from '@/i18n';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const outbox = new SqliteOutboxStore();

const FLY_STYLE: Record<FlyStatus['state'], { bg: string; key: string }> = {
  flying: { bg: '#EAF2EC', key: 'home.flyFlying' },
  hold: { bg: '#FCF3E3', key: 'home.flyHold' },
  closed: { bg: '#F7E7E1', key: 'home.flyClosed' },
};

/**
 * P3.3 — Home: today-at-the-festival feed (SQLite, offline), the official
 * fly-status banner (subscription-driven, cached last-known), and one-tap
 * SOS (call via dialer + one consented location report through the outbox).
 */
export default function Home() {
  const { t } = useTranslation();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const channel = (Constants.expoConfig?.extra?.APP_CHANNEL as string) ?? 'development';
  const [sosArmed, setSosArmed] = useState(false);
  const [sosDone, setSosDone] = useState(false);

  const fly = useQuery({
    queryKey: ['flyStatus'],
    queryFn: () => getFlyStatus(kvStore),
    networkMode: 'always',
    staleTime: 30_000,
  });

  // The banner flips the moment the safety officer calls it.
  useEffect(() => {
    const unsubscribe = subscribeFlyStatus(kvStore, (status) => {
      queryClient.setQueryData(['flyStatus'], status);
    });
    return unsubscribe;
  }, [queryClient]);

  const day = festivalDayFor(Date.now());
  const feed = useQuery({
    queryKey: ['schedule', day],
    queryFn: () => listEventsForDay(day as string),
    enabled: day !== null,
    networkMode: 'always',
  });

  const onSos = async () => {
    if (!sosArmed) {
      setSosArmed(true);
      return;
    }
    setSosArmed(false);
    const session = await fetchAuthSession().catch(() => null);
    const sub = String(session?.tokens?.idToken?.payload?.sub ?? 'anonymous');
    await triggerSos(
      {
        outbox,
        openUrl: (url) => Linking.openURL(url),
        getLocation: getLocationOnce,
      },
      { sub, nowMs: Date.now() },
    );
    setSosDone(true);
  };

  const titleFor = (titleEn?: string | null, titleHi?: string | null) =>
    (currentLocale() === 'hi' && titleHi ? titleHi : titleEn) ?? '';

  const flyStatus = fly.data;

  return (
    <Screen title={t('home.todayAtFestival')}>
      {flyStatus ? (
        <View style={[styles.flyBanner, { backgroundColor: FLY_STYLE[flyStatus.state].bg }]}>
          <Text style={styles.flyText}>{t(FLY_STYLE[flyStatus.state].key)}</Text>
          {currentLocale() === 'hi' && flyStatus.reasonHi ? (
            <Text style={styles.flyReason}>{flyStatus.reasonHi}</Text>
          ) : flyStatus.reasonEn ? (
            <Text style={styles.flyReason}>{flyStatus.reasonEn}</Text>
          ) : null}
          {flyStatus.state !== 'flying' && flyStatus.refundsAutoQueued ? (
            <Text style={styles.flyRefund}>{t('home.flyRefundAuto')}</Text>
          ) : null}
        </View>
      ) : null}

      {channel === 'direct' ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{t('common.directChannelNotice')}</Text>
        </View>
      ) : null}

      {(feed.data ?? []).slice(0, 4).map((event) => (
        <View key={event.id} style={styles.card}>
          <Text style={styles.cardTitle}>{titleFor(event.titleEn, event.titleHi)}</Text>
          <Text style={styles.cardMeta}>
            {event.startsAtSec
              ? new Date(event.startsAtSec * 1000).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''}
            {event.venue ? ` · ${event.venue}` : ''}
          </Text>
        </View>
      ))}
      {day !== null && (feed.data?.length ?? 0) === 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardMeta}>{t('home.feedEmpty')}</Text>
        </View>
      ) : null}

      {hasRole(auth, 'volunteer') ? (
        <Link href="/(volunteer)/roster" style={styles.roleLink}>
          <Text style={styles.roleLinkText}>{t('tabs.roster')} →</Text>
        </Link>
      ) : null}
      {hasRole(auth, 'partner') ? (
        <Link href="/(partner)/stalls" style={styles.roleLink}>
          <Text style={styles.roleLinkText}>{t('tabs.stalls')} →</Text>
        </Link>
      ) : null}

      <View style={styles.sosWrap}>
        {sosDone ? <Text style={styles.sosDone}>{t('home.sosDone')}</Text> : null}
        <Pressable
          style={[styles.sosButton, sosArmed && styles.sosArmed]}
          onPress={onSos}
          accessibilityRole="button"
          accessibilityLabel={sosArmed ? t('home.sosConfirm') : t('home.sos')}
        >
          <Text style={styles.sosText}>{sosArmed ? t('home.sosConfirm') : t('home.sos')}</Text>
        </Pressable>
        {sosArmed ? (
          <Pressable
            style={styles.sosCancel}
            onPress={() => setSosArmed(false)}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
          >
            <Text style={styles.sosCancelText}>{t('common.cancel')}</Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flyBanner: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  flyText: { ...typeScale.heading, color: color.text },
  flyReason: { ...typeScale.caption, color: color.textMuted },
  flyRefund: { ...typeScale.caption, color: palette.slate },
  notice: {
    backgroundColor: '#FCF3E3',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: { ...typeScale.caption, color: color.text },
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
  roleLink: { marginTop: spacing.sm },
  roleLinkText: { ...typeScale.body, color: color.info, fontWeight: '600' },
  sosWrap: { marginTop: 'auto', paddingVertical: spacing.lg, gap: spacing.sm },
  sosDone: { ...typeScale.caption, color: color.success, textAlign: 'center' },
  sosButton: {
    backgroundColor: color.danger,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET + 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosArmed: { backgroundColor: palette.ink },
  sosText: { ...typeScale.heading, color: color.textInverse },
  sosCancel: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosCancelText: { ...typeScale.body, color: color.textMuted },
});
