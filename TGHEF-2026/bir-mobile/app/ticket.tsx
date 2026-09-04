import { useQuery } from '@tanstack/react-query';
import * as Brightness from 'expo-brightness';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import {
  fetchMasterPass,
  getCachedMasterPass,
  ProfileIncompleteError,
  type MasterPass,
} from '@/features/passes/masterPass';
import { kvStore } from '@/offline/db';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

/**
 * The master ticket (Phase 1): one QR per visitor. Renders from the local cache
 * so it shows with airplane mode on, refreshes from GET /pass/master when
 * online, and sends the visitor to complete their profile (428) if needed.
 */
export default function TicketScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const pass = useQuery<MasterPass | null, Error>({
    queryKey: ['masterPass'],
    networkMode: 'always',
    queryFn: async () => {
      try {
        return await fetchMasterPass(kvStore);
      } catch (e) {
        if (e instanceof ProfileIncompleteError) throw e;
        // Offline / transient: fall back to the last-known pass.
        const cached = await getCachedMasterPass(kvStore);
        if (cached) return cached;
        throw e;
      }
    },
  });

  useEffect(() => {
    let previous: number | null = null;
    void (async () => {
      const { status } = await Brightness.requestPermissionsAsync();
      if (status !== 'granted') return;
      previous = await Brightness.getBrightnessAsync();
      await Brightness.setBrightnessAsync(1);
    })();
    return () => {
      if (previous !== null) void Brightness.setBrightnessAsync(previous);
    };
  }, []);

  if (pass.isLoading) {
    return (
      <Screen title={t('ticket.title')}>
        <View style={styles.center}>
          <ParagliderSpinner />
        </View>
      </Screen>
    );
  }

  if (pass.error instanceof ProfileIncompleteError) {
    return (
      <Screen title={t('ticket.title')}>
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🪪</Text>
          <Text style={styles.emptyTitle}>{t('ticket.completeProfile')}</Text>
          <Text style={styles.emptyText}>{t('ticket.completeProfileText')}</Text>
          <Pressable
            style={styles.btn}
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>{t('ticket.completeProfileCta')}</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const p = pass.data;
  if (!p) {
    return (
      <Screen title={t('ticket.title')}>
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t('ticket.unavailable')}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={t('ticket.title')}>
      <View style={styles.card}>
        <View style={styles.qrWrap}>
          <QRCode value={p.token} size={232} backgroundColor="#FFFFFF" color={palette.ink} />
        </View>
        <Text style={styles.name}>{p.name}</Text>
        <View style={styles.metaRow}>
          {p.ageBand ? <Text style={styles.pill}>{t(`ageBand.${p.ageBand}`)}</Text> : null}
          <Text style={styles.passId}>{p.passId}</Text>
        </View>
        <Text style={styles.subtitle}>{t('ticket.subtitle')}</Text>
      </View>
      <Text style={styles.offline}>{t('ticket.offlineNote')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: color.cardBorder,
  },
  qrWrap: { padding: spacing.md, backgroundColor: '#FFFFFF', borderRadius: radius.md },
  name: { ...typeScale.title, color: palette.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pill: {
    ...typeScale.caption,
    color: palette.pine,
    backgroundColor: '#EAF1EC',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    fontWeight: '700',
  },
  passId: { ...typeScale.body, color: color.textMuted, fontVariant: ['tabular-nums'] },
  subtitle: {
    ...typeScale.caption,
    color: color.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  offline: {
    ...typeScale.caption,
    color: color.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  emptyIcon: { fontSize: 42 },
  emptyTitle: { ...typeScale.heading, color: color.text },
  emptyText: {
    ...typeScale.body,
    color: color.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  btn: {
    backgroundColor: palette.marigold,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET + 6,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  btnText: { ...typeScale.body, color: palette.ink, fontWeight: '800' },
});
