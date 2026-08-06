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
import { FESTIVAL_DAYS, festivalDayFor } from '@/features/cultural-nights/schedule';
import {
  getFlyStatus,
  subscribeFlyStatus,
  type FlyStatus,
} from '@/features/flight-status/flyStatus';
import { AlpineScene } from '@/features/home/AlpineScene';
import { getLocationOnce, triggerSos } from '@/features/sos/sos';
import { listPasses } from '@/features/tickets/passStore';
import { toggleLocale } from '@/i18n';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { palette } from '@/ui/tokens';

const outbox = new SqliteOutboxStore();

// Home-design shades (Bir_Fest2026_App_Home mock) beyond the core tokens.
const M = {
  heroTop: '#0F1A21',
  heroMid: '#1C2E38',
  heroLow: '#24404A',
  inkTwo: '#20313B',
  pineDark: '#1F4237',
  marigoldSoft: '#F2C98A',
  txtSoft: '#5D6B74',
  line: '#DCE4E0',
  flyOk: '#4ECF93',
  flyOkText: '#7FD6AC',
  flyHold: '#E8A13D',
  flyClosed: '#E8734D',
} as const;

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const FLY_CHIP: Record<FlyStatus['state'], { dot: string; key: string }> = {
  flying: { dot: M.flyOk, key: 'home.flyChipOpen' },
  hold: { dot: M.flyHold, key: 'home.flyChipHold' },
  closed: { dot: M.flyClosed, key: 'home.flyChipClosed' },
};

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

export default function Home() {
  const { t } = useTranslation();
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

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} bounces={false}>
      {/* ============ HERO ============ */}
      <LinearGradient colors={[M.heroTop, M.heroMid, M.heroLow]} locations={[0, 0.55, 1]}>
        <View style={[styles.hero, { paddingTop: insets.top + 18 }]}>
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
              <Text style={styles.flyQ}>{t('home.flyQ')}</Text>
              <View style={styles.flyRow}>
                <View style={[styles.flyDot, { backgroundColor: FLY_CHIP[flyStatus.state].dot }]} />
                <Text style={[styles.flyA, flyStatus.state !== 'flying' && styles.flyAWarn]}>
                  {t(FLY_CHIP[flyStatus.state].key)} · {flyTime}
                </Text>
              </View>
            </View>
          ) : null}

          <Text style={styles.date}>{t('home.heroDates')}</Text>
          <Text style={styles.h1}>{t('home.heroTitle')}</Text>
          <Text style={styles.tag}>{t('home.heroTag')}</Text>
        </View>
        <AlpineScene />
      </LinearGradient>

      <View style={styles.section}>
        {auth.demo ? (
          <View style={styles.demoBanner}>
            <Text style={styles.demoText}>{t('common.demoNotice')}</Text>
          </View>
        ) : null}

        {/* CO-001 E3: auto-refund state rendering during a hold/closure */}
        {flyStatus && flyStatus.state !== 'flying' && flyStatus.refundsAutoQueued ? (
          <View style={styles.refund}>
            <Text style={styles.refundText}>{t('home.flyRefundAuto')}</Text>
          </View>
        ) : null}

        {/* ============ WELCOME ============ */}
        <View style={styles.welcome}>
          <View style={styles.welcomeText}>
            <Text style={styles.welcomeH2}>{t('home.namaste')}</Text>
            <Text style={styles.welcomeSub}>{t('home.welcomeSub')}</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>
              {dayNumber ? t('home.dayPill', { n: dayNumber }) : t('home.dayPillSoon')}
            </Text>
          </View>
        </View>

        {/* ============ MY PASS ============ */}
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
              <Text style={styles.passT2}>
                {pass
                  ? `${t(`tickets.type${pass.typ === 'seat-entry' ? 'SeatEntry' : pass.typ === 'volunteer-attendance' ? 'VolunteerAttendance' : pass.typ.charAt(0).toUpperCase() + pass.typ.slice(1)}`)} · ${pass.claims.zones[0]?.toUpperCase() ?? ''}`
                  : t('home.getPassTitle')}
              </Text>
              <Text style={styles.passT3}>{t('home.passOfflineShort')}</Text>
            </View>
            <View style={styles.passGo}>
              <Text style={styles.passGoText}>›</Text>
            </View>
          </LinearGradient>
        </Pressable>

        {/* ============ FESTIVAL AT YOUR FINGERTIPS ============ */}
        <Text style={styles.qaTitle}>{t('home.fingertips')}</Text>
        <View style={styles.about}>
          <Text style={styles.aboutEn}>{t('home.aboutEn')}</Text>
          <Text style={styles.aboutHi}>{t('home.aboutHi')}</Text>
        </View>

        <Pressable
          onPress={() => router.push('/highlights')}
          accessibilityRole="button"
          accessibilityLabel={t('home.highlights')}
        >
          <LinearGradient
            colors={[palette.ink, M.inkTwo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.7 }}
            style={styles.hlBtn}
          >
            <View style={styles.hlIcon}>
              <Text style={styles.hlEmoji}>🏆</Text>
            </View>
            <View style={styles.hlBody}>
              <Text style={styles.hlT}>{t('home.highlights')}</Text>
              <Text style={styles.hlS}>{t('home.highlightsSub')}</Text>
            </View>
            <View style={styles.hlChev}>
              <Text style={styles.hlChevText}>›</Text>
            </View>
          </LinearGradient>
        </Pressable>

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

        {/* ============ MISSION ============ */}
        <View style={styles.mission}>
          <Text style={styles.missionHi}>{t('home.missionHi')}</Text>
          <Text style={styles.missionEn}>{t('home.missionEn')}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  content: { paddingBottom: 24 },
  hero: { paddingHorizontal: 20 },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { fontFamily: 'Fraunces_600SemiBold', fontSize: 15, color: '#FFFFFF', letterSpacing: 0.3 },
  brandYear: { color: palette.marigold },
  lang: {
    borderWidth: 1,
    borderColor: 'rgba(242,201,138,0.45)',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(232,161,61,0.08)',
    minHeight: 30,
    justifyContent: 'center',
  },
  langText: { fontSize: 12, fontWeight: '600', color: M.marigoldSoft },
  fly: {
    position: 'absolute',
    right: 16,
    top: 96,
    backgroundColor: 'rgba(23,35,43,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(95,160,131,0.6)',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'flex-end',
    zIndex: 2,
  },
  flyQ: { fontFamily: MONO, fontSize: 9, letterSpacing: 1.2, color: '#AEC8BC' },
  flyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  flyDot: { width: 8, height: 8, borderRadius: 4 },
  flyA: { fontWeight: '700', fontSize: 13, color: M.flyOkText },
  flyAWarn: { color: M.marigoldSoft },
  date: {
    marginTop: 14,
    fontFamily: MONO,
    fontSize: 10.5,
    letterSpacing: 1.2,
    color: M.marigoldSoft,
  },
  h1: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 31,
    lineHeight: 34,
    color: '#FFFFFF',
    marginTop: 6,
  },
  tag: { marginTop: 8, fontSize: 14.5, color: '#DCE6DE', fontWeight: '500', marginBottom: 4 },
  section: { paddingHorizontal: 20 },
  demoBanner: {
    backgroundColor: palette.ink,
    borderRadius: 12,
    padding: 10,
    marginTop: 14,
  },
  demoText: { fontSize: 11, color: palette.paper, textAlign: 'center' },
  refund: {
    backgroundColor: '#EAF0F5',
    borderWidth: 1,
    borderColor: '#CBDBE7',
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
  },
  refundText: { fontSize: 11.5, color: palette.slate, textAlign: 'center' },
  welcome: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    gap: 10,
  },
  welcomeText: { flex: 1 },
  welcomeH2: { fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: palette.ink },
  welcomeSub: { fontSize: 12.5, color: M.txtSoft, marginTop: 3 },
  pill: {
    backgroundColor: '#E4EEE8',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  pillText: { fontSize: 11, fontWeight: '700', color: palette.pine },
  pass: {
    marginTop: 14,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    overflow: 'hidden',
  },
  passRing: {
    position: 'absolute',
    right: -40,
    top: -40,
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 22,
    borderColor: 'rgba(232,161,61,0.14)',
  },
  passQr: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  passBody: { flex: 1 },
  passT1: { fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.2, color: '#BEDCCB' },
  passT2: { fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: '#FFFFFF', marginTop: 2 },
  passT3: { fontSize: 11.5, color: '#CFE0D6', marginTop: 4 },
  passGo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(232,161,61,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  passGoText: { color: palette.ink, fontWeight: '800', fontSize: 16, marginTop: -2 },
  qaTitle: {
    marginTop: 22,
    fontFamily: MONO,
    fontSize: 10.5,
    letterSpacing: 1.2,
    color: palette.flagRed,
    fontWeight: '700',
  },
  about: {
    marginTop: 12,
    backgroundColor: '#EAF3EE',
    borderWidth: 1,
    borderColor: '#D3E2D8',
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  aboutEn: { fontSize: 12.5, color: '#27423A', lineHeight: 19, fontWeight: '500' },
  aboutHi: { fontSize: 12, color: '#4E6157', marginTop: 5 },
  hlBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(232,161,61,0.35)',
  },
  hlIcon: {
    width: 50,
    height: 50,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(232,161,61,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(232,161,61,0.45)',
  },
  hlEmoji: { fontSize: 24 },
  hlBody: { flex: 1 },
  hlT: { fontFamily: 'Fraunces_600SemiBold', fontSize: 19, color: '#FFFFFF' },
  hlS: { fontSize: 11.5, color: '#C9D6CE', marginTop: 3, lineHeight: 16 },
  hlChev: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.marigold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hlChevText: { color: palette.ink, fontWeight: '800', fontSize: 17, marginTop: -2 },
  sos: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FBEFEA',
    borderWidth: 1,
    borderColor: '#EBCDC2',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  sosB: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.flagRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosBText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  sosT: { flex: 1, fontSize: 12, color: '#7A4030', lineHeight: 16 },
  sosCancel: { alignItems: 'center', paddingVertical: 8 },
  sosCancelText: { fontSize: 13, color: M.txtSoft },
  mission: {
    marginTop: 22,
    marginBottom: 8,
    borderRadius: 18,
    backgroundColor: M.pineDark,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  missionHi: {
    fontWeight: '700',
    fontSize: 15.5,
    lineHeight: 23,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  missionEn: { fontSize: 11.5, color: '#C4D7CB', marginTop: 5, textAlign: 'center' },
});
