import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { G, Rect } from 'react-native-svg';

import { useAuth } from '@/auth/useAuth';
import { festivalConcluded } from '@/config/flags';
import { FESTIVAL_DAYS, festivalDayFor } from '@/features/cultural-nights/schedule';
import {
  getFlyStatus,
  subscribeFlyStatus,
  type FlyStatus,
} from '@/features/flight-status/flyStatus';
import { announcementText, loadAnnouncements } from '@/features/notifications/announcements';
import { getLocationOnce, triggerSos } from '@/features/sos/sos';
import { listPasses } from '@/features/tickets/passStore';
import { toggleLocale } from '@/i18n';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { AlpineBackdrop } from '@/ui/AlpineBackdrop';
import { palette } from '@/ui/tokens';

const outbox = new SqliteOutboxStore();

const M = {
  pineDark: '#1F4237',
  marigoldSoft: '#F2C98A',
  txtSoft: '#5D6B74',
  line: '#DCE4E0',
  flyOk: '#4ECF93',
  flyHold: '#E8A13D',
  flyClosed: '#E8734D',
} as const;

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const FLY_CHIP: Record<FlyStatus['state'], { dot: string; key: string }> = {
  flying: { dot: M.flyOk, key: 'home.flyChipOpen' },
  hold: { dot: M.flyHold, key: 'home.flyChipHold' },
  closed: { dot: M.flyClosed, key: 'home.flyChipClosed' },
};

function SectionHeader({ label }: { label: string }) {
  return <Text style={styles.secHeader}>{label}</Text>;
}

/** Decorative mini-QR for the pass card (the real QR lives on the pass screen). */
function MiniQr() {
  return (
    <Svg width={48} height={48} viewBox="0 0 48 48">
      <G fill={palette.ink}>
        <Rect x={2} y={2} width={14} height={14} rx={2} />
        <Rect x={6} y={6} width={6} height={6} fill="#fff" />
        <Rect x={32} y={2} width={14} height={14} rx={2} />
        <Rect x={36} y={6} width={6} height={6} fill="#fff" />
        <Rect x={2} y={32} width={14} height={14} rx={2} />
        <Rect x={6} y={36} width={6} height={6} fill="#fff" />
        <Rect x={22} y={4} width={4} height={4} />
        <Rect x={22} y={12} width={4} height={4} />
        <Rect x={20} y={20} width={6} height={6} />
        <Rect x={30} y={22} width={4} height={4} />
        <Rect x={38} y={20} width={6} height={4} />
        <Rect x={22} y={30} width={4} height={6} />
        <Rect x={30} y={32} width={6} height={6} />
        <Rect x={40} y={30} width={4} height={4} />
        <Rect x={32} y={42} width={4} height={4} />
        <Rect x={42} y={38} width={4} height={8} />
        <Rect x={4} y={22} width={4} height={4} />
        <Rect x={12} y={22} width={4} height={4} />
      </G>
    </Svg>
  );
}

function Tile({
  emoji,
  title,
  sub,
  onPress,
}: {
  emoji: string;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.tile}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.tileIcon}>
        <Text style={styles.tileEmoji}>{emoji}</Text>
      </View>
      <Text style={styles.tileT}>{title}</Text>
      <Text style={styles.tileS}>{sub}</Text>
    </Pressable>
  );
}

export default function Home() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [sosArmed, setSosArmed] = useState(false);
  const [sosDone, setSosDone] = useState(false);

  const fly = useQuery({
    queryKey: ['flyStatus'],
    queryFn: () => getFlyStatus(kvStore),
    networkMode: 'always',
    staleTime: 30_000,
  });
  useEffect(() => {
    const unsubscribe = subscribeFlyStatus(kvStore, (status) => {
      queryClient.setQueryData(['flyStatus'], status);
    });
    return unsubscribe;
  }, [queryClient]);

  const passes = useQuery({ queryKey: ['passes'], queryFn: listPasses, networkMode: 'always' });
  const pass = passes.data?.[0];

  const notices = useQuery({
    queryKey: ['announcements'],
    queryFn: () => loadAnnouncements(kvStore),
    networkMode: 'always',
    staleTime: 60_000,
  });

  const day = festivalDayFor(Date.now());
  const dayNumber = day ? FESTIVAL_DAYS.indexOf(day) + 1 : null;

  const onSos = async () => {
    if (!sosArmed) {
      setSosArmed(true);
      return;
    }
    setSosArmed(false);
    const session = await fetchAuthSession().catch(() => null);
    const sub = String(session?.tokens?.idToken?.payload?.sub ?? 'anonymous');
    await triggerSos(
      { outbox, openUrl: (url) => Linking.openURL(url), getLocation: getLocationOnce },
      { sub, nowMs: Date.now() },
    );
    setSosDone(true);
  };

  const flyStatus = fly.data;
  const flyTime = flyStatus
    ? new Date(flyStatus.updatedAtSec * 1000).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const heroH = insets.top + 320;

  const passLabel = pass
    ? `${t(
        `tickets.type${
          pass.typ === 'seat-entry'
            ? 'SeatEntry'
            : pass.typ === 'volunteer-attendance'
              ? 'VolunteerAttendance'
              : pass.typ.charAt(0).toUpperCase() + pass.typ.slice(1)
        }`,
      )} · ${pass.claims.zones[0]?.toUpperCase() ?? ''}`
    : t('home.getPassTitle');

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {/* ============ IMMERSIVE HERO ============ */}
        <View style={[styles.hero, { height: heroH, paddingTop: insets.top + 14 }]}>
          <AlpineBackdrop height={heroH} />
          <View style={styles.heroContent}>
            <View style={styles.topbar}>
              <Text style={styles.brand}>
                BIR FESTIVAL <Text style={styles.brandYear}>2026</Text>
              </Text>
              <Pressable
                onPress={toggleLocale}
                style={styles.lang}
                accessibilityRole="button"
                accessibilityLabel={t('common.languageSwitch')}
              >
                <Text style={styles.langText}>{t('common.languageSwitch')}</Text>
              </Pressable>
            </View>

            {flyStatus ? (
              <View style={styles.fly}>
                <View style={[styles.flyDot, { backgroundColor: FLY_CHIP[flyStatus.state].dot }]} />
                <Text style={[styles.flyA, flyStatus.state !== 'flying' && styles.flyAWarn]}>
                  {t(FLY_CHIP[flyStatus.state].key)} · {flyTime}
                </Text>
              </View>
            ) : null}

            <View style={styles.heroSpacer} />
            <Text style={styles.h1}>{t('home.heroTitle')}</Text>
            <Text style={styles.date}>{t('home.heroDates')}</Text>
          </View>
        </View>

        <View style={styles.body}>
          {auth.demo ? (
            <View style={styles.demoBanner}>
              <Text style={styles.demoText}>{t('common.demoNotice')}</Text>
            </View>
          ) : null}
          {festivalConcluded() ? (
            <View style={styles.refund}>
              <Text style={styles.refundText}>{t('festival.concludedShort')}</Text>
            </View>
          ) : null}
          {flyStatus && flyStatus.state !== 'flying' && flyStatus.refundsAutoQueued ? (
            <View style={styles.refund}>
              <Text style={styles.refundText}>{t('home.flyRefundAuto')}</Text>
            </View>
          ) : null}

          {(notices.data ?? []).map((n) => {
            const txt = announcementText(n, i18n.language);
            const alert = n.level === 'alert';
            return (
              <View key={n.id} style={[styles.notice, alert && styles.noticeAlert]}>
                <Text style={[styles.noticeTitle, alert && styles.noticeTitleAlert]}>
                  {txt.title}
                </Text>
                <Text style={styles.noticeBody}>{txt.body}</Text>
              </View>
            );
          })}

          {/* welcome */}
          <View style={styles.welcome}>
            <View style={{ flex: 1 }}>
              <Text style={styles.welcomeH2}>{t('home.namaste')}</Text>
              <Text style={styles.welcomeSub}>{t('home.welcomeSub')}</Text>
            </View>
            <View style={styles.pill}>
              <Text style={styles.pillText}>
                {dayNumber ? t('home.dayPill', { n: dayNumber }) : t('home.dayPillSoon')}
              </Text>
            </View>
          </View>

          {/* ============ YOUR BOOKINGS ============ */}
          <SectionHeader label={t('home.secBookings')} />
          <Pressable
            onPress={() =>
              pass
                ? router.push({ pathname: '/pass/[jti]', params: { jti: pass.jti } })
                : router.push('/buy')
            }
            accessibilityRole="button"
            accessibilityLabel={pass ? t('home.myPassLabel') : t('home.getPassTitle')}
          >
            <LinearGradient
              colors={[M.pineDark, palette.pine]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.pass}
            >
              <View style={styles.passRing} />
              <View style={styles.passQr}>
                <MiniQr />
              </View>
              <View style={styles.passBody}>
                <Text style={styles.passT1}>{t('home.myPassLabel')}</Text>
                <Text style={styles.passT2}>{passLabel}</Text>
                <Text style={styles.passT3}>{t('home.passOfflineShort')}</Text>
              </View>
              <Text style={styles.passGo}>›</Text>
            </LinearGradient>
          </Pressable>
          <View style={styles.tiles}>
            <Tile
              emoji="🎫"
              title={t('home.buyTitle')}
              sub={t('home.buySub')}
              onPress={() => router.push('/buy')}
            />
            <Tile
              emoji="📋"
              title={t('highlights.myRegistrations')}
              sub={t('home.myRegSub')}
              onPress={() => router.push('/highlights/my')}
            />
          </View>

          {/* ============ PLAN AHEAD ============ */}
          <SectionHeader label={t('home.secPlan')} />
          <Pressable
            onPress={() => router.push('/highlights')}
            accessibilityRole="button"
            accessibilityLabel={t('home.highlights')}
          >
            <LinearGradient
              colors={[palette.ink, '#20313B']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0.7 }}
              style={styles.hlBtn}
            >
              <View style={styles.hlIcon}>
                <Text style={styles.hlEmoji}>🏆</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.hlT}>{t('home.highlights')}</Text>
                <Text style={styles.hlS}>{t('home.highlightsSub')}</Text>
              </View>
              <Text style={styles.hlChev}>›</Text>
            </LinearGradient>
          </Pressable>
          <View style={styles.tiles}>
            <Tile
              emoji="🗓️"
              title={t('tabs.schedule')}
              sub={t('home.tileScheduleSub')}
              onPress={() => router.push('/(visitor)/schedule')}
            />
            <Tile
              emoji="🧭"
              title={t('tabs.explore')}
              sub={t('home.tileExploreSub')}
              onPress={() => router.push('/(visitor)/assistant')}
            />
          </View>

          {/* ============ ABOUT ============ */}
          <SectionHeader label={t('home.secAbout')} />
          <View style={styles.about}>
            <Text style={styles.aboutEn}>{t('home.aboutEn')}</Text>
            <Text style={styles.aboutHi}>{t('home.aboutHi')}</Text>
          </View>
          <View style={styles.mission}>
            <Text style={styles.missionHi}>{t('home.missionHi')}</Text>
            <Text style={styles.missionEn}>{t('home.missionEn')}</Text>
          </View>

          {/* ============ SOS ============ */}
          <Pressable
            style={styles.sos}
            onPress={onSos}
            accessibilityRole="button"
            accessibilityLabel={sosArmed ? t('home.sosConfirm') : t('home.sos')}
          >
            <View style={styles.sosB}>
              <Text style={styles.sosBText}>SOS</Text>
            </View>
            <Text style={styles.sosT}>
              {sosArmed ? t('home.sosConfirm') : sosDone ? t('home.sosDone') : t('home.sosStrip')}
            </Text>
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  content: { paddingBottom: 28 },

  // hero
  hero: { justifyContent: 'flex-start' },
  heroContent: { flex: 1, paddingHorizontal: 20, paddingBottom: 20 },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { fontFamily: 'Fraunces_600SemiBold', fontSize: 15, color: '#FFFFFF', letterSpacing: 0.3 },
  brandYear: { color: palette.marigold },
  lang: {
    borderWidth: 1,
    borderColor: 'rgba(242,201,138,0.45)',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(232,161,61,0.10)',
  },
  langText: { color: M.marigoldSoft, fontSize: 12, fontWeight: '600' },
  fly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    marginTop: 10,
    backgroundColor: 'rgba(12,24,20,0.5)',
    borderColor: 'rgba(120,190,150,0.4)',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  flyDot: { width: 8, height: 8, borderRadius: 4 },
  flyA: { color: '#8FE6B4', fontSize: 12.5, fontWeight: '700' },
  flyAWarn: { color: M.marigoldSoft },
  heroSpacer: { flex: 1 },
  h1: { fontFamily: 'Fraunces_600SemiBold', fontSize: 34, lineHeight: 36, color: '#F1F5EF' },
  date: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#B9CFC6',
    marginTop: 10,
  },

  // body
  body: { paddingHorizontal: 16, marginTop: -14 },
  demoBanner: {
    backgroundColor: palette.ink,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  demoText: { color: palette.paper, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  refund: {
    backgroundColor: '#FCF3E3',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  refundText: { color: palette.ink, fontSize: 12.5, lineHeight: 18 },
  notice: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E7E1',
    borderLeftWidth: 4,
    borderLeftColor: palette.slate,
    padding: 12,
    marginBottom: 10,
  },
  noticeAlert: { borderLeftColor: palette.flagRed, backgroundColor: '#FBEEE9' },
  noticeTitle: { color: palette.ink, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  noticeTitleAlert: { color: palette.flagRed },
  noticeBody: { color: '#4A5A52', fontSize: 12.5, lineHeight: 18 },

  welcome: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  welcomeH2: { fontFamily: 'Fraunces_600SemiBold', fontSize: 22, color: palette.ink },
  welcomeSub: { fontSize: 13, color: M.txtSoft, marginTop: 3 },
  pill: {
    backgroundColor: '#E4EEE8',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  pillText: { color: palette.pine, fontSize: 12, fontWeight: '700' },

  secHeader: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: palette.slate,
    marginTop: 22,
    marginBottom: 10,
  },

  // pass card
  pass: {
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  passRing: {
    position: 'absolute',
    right: -40,
    top: -30,
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 24,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  passQr: { backgroundColor: '#fff', borderRadius: 10, padding: 6, marginRight: 14 },
  passBody: { flex: 1 },
  passT1: {
    color: '#B7D3C2',
    fontSize: 10.5,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  passT2: { color: '#EAF3EC', fontFamily: 'Fraunces_600SemiBold', fontSize: 18, marginTop: 3 },
  passT3: { color: '#B7D3C2', fontSize: 11, marginTop: 4 },
  passGo: { color: palette.marigold, fontSize: 26, fontWeight: '700', marginLeft: 8 },

  // tiles
  tiles: { flexDirection: 'row', gap: 11, marginTop: 11 },
  tile: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: M.line,
    borderRadius: 16,
    padding: 14,
    minHeight: 96,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F1EAD9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  tileEmoji: { fontSize: 17 },
  tileT: { fontSize: 13.5, fontWeight: '600', color: palette.ink },
  tileS: { fontSize: 11, color: M.txtSoft, marginTop: 2 },

  // highlights
  hlBtn: { borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center' },
  hlIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(232,161,61,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  hlEmoji: { fontSize: 20 },
  hlT: { color: '#F1F5EF', fontFamily: 'Fraunces_600SemiBold', fontSize: 17 },
  hlS: { color: '#9FB2AC', fontSize: 12, marginTop: 2 },
  hlChev: { color: palette.marigold, fontSize: 22, fontWeight: '700' },

  // about
  about: {
    backgroundColor: '#EEF4EF',
    borderColor: M.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
  },
  aboutEn: { fontSize: 13.5, color: '#3c4a52', lineHeight: 20 },
  aboutHi: { fontSize: 12.5, color: M.txtSoft, lineHeight: 19, marginTop: 8 },
  mission: { marginTop: 12, paddingHorizontal: 4 },
  missionHi: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 15,
    color: palette.pine,
    lineHeight: 22,
  },
  missionEn: { fontSize: 12, color: M.txtSoft, marginTop: 4 },

  // sos
  sos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FBEEE9',
    borderColor: '#E7CFC5',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginTop: 22,
  },
  sosB: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.flagRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosBText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  sosT: { flex: 1, fontSize: 12.5, color: '#7a3b2b', lineHeight: 18 },
  sosCancel: { alignSelf: 'center', paddingVertical: 10, marginTop: 4 },
  sosCancelText: { color: M.txtSoft, fontSize: 13 },
});
