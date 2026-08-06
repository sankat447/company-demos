import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';

import { participantNumber } from '@/features/badges/badges';
import { findItem, loadCatalog } from '@/features/highlights/catalog';
import { getPass } from '@/features/tickets/passStore';
import { kvStore } from '@/offline/db';
import { FlightLineDivider } from '@/ui/FlightLineDivider';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

/**
 * CO-003 §4 visual badge: festival branding (ink header, flight line,
 * marigold accent), name, competition EN+HI, participant number, the QR —
 * scannable by the same offline gate verifier. "Save badge" exports a
 * wallet-style PNG via the share sheet. No photo upload yet (initials
 * avatar); gender never appears (§5).
 */
export default function Badge() {
  const { t } = useTranslation();
  const { jti, name } = useLocalSearchParams<{ jti: string; name?: string }>();
  const shotRef = useRef<ViewShot>(null);

  const pass = useQuery({
    queryKey: ['pass', jti],
    queryFn: () => getPass(jti),
    enabled: !!jti,
    networkMode: 'always',
  });
  const catalog = useQuery({
    queryKey: ['highlights', 'catalog'],
    queryFn: () => loadCatalog(kvStore, Date.now()),
    networkMode: 'always',
  });

  const claims = pass.data?.claims;
  const competition =
    claims?.competition && catalog.data ? findItem(catalog.data, claims.competition) : null;
  const displayName = name ?? t('badge.participant');
  const initials = displayName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const save = async () => {
    const Sharing = await import('expo-sharing');
    const uri = await shotRef.current?.capture?.();
    if (uri && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    }
  };

  return (
    <Screen title={t('badge.title')}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {pass.data && claims ? (
          <>
            <ViewShot ref={shotRef} options={{ format: 'png', quality: 1 }}>
              <View style={styles.badge}>
                <Text style={styles.brand}>
                  BIR FESTIVAL <Text style={styles.brandYear}>2026</Text>
                </Text>
                <FlightLineDivider width={200} />
                <View style={styles.row}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                  <View style={styles.id}>
                    <Text style={styles.name}>{displayName}</Text>
                    {competition ? (
                      <>
                        <Text style={styles.comp}>{competition.title}</Text>
                        <Text style={styles.compHi}>{competition.titleHi}</Text>
                      </>
                    ) : (
                      <Text style={styles.comp}>{claims.competition ?? ''}</Text>
                    )}
                    <Text style={styles.number}>{participantNumber(claims.jti)}</Text>
                  </View>
                </View>
                <View style={styles.qrWell}>
                  <QRCode value={pass.data.token} size={180} backgroundColor="#FFFFFF" />
                </View>
                <Text style={styles.zones}>
                  {claims.zones.join(' · ').toUpperCase()} · {t('badge.scannableOffline')}
                </Text>
              </View>
            </ViewShot>
            <Pressable
              style={styles.save}
              onPress={save}
              accessibilityRole="button"
              accessibilityLabel={t('badge.save')}
            >
              <Text style={styles.saveText}>{t('badge.save')}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.missing}>{t('tickets.empty')}</Text>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  badge: {
    backgroundColor: palette.ink,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  brand: { fontFamily: 'Fraunces_600SemiBold', fontSize: 16, color: '#FFFFFF', letterSpacing: 1 },
  brandYear: { color: palette.marigold },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, alignSelf: 'stretch' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(232,161,61,0.18)',
    borderWidth: 1,
    borderColor: palette.marigold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: palette.marigold, fontWeight: '800', fontSize: 18 },
  id: { flex: 1 },
  name: { fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: '#FFFFFF' },
  comp: { fontSize: 12.5, color: '#C9D6CE', marginTop: 2 },
  compHi: { fontSize: 11.5, color: '#C9D6CE' },
  number: { fontSize: 13, color: palette.marigold, fontWeight: '700', marginTop: 3 },
  qrWell: { backgroundColor: '#FFFFFF', borderRadius: radius.md, padding: spacing.md },
  zones: { fontSize: 10, color: '#8FA3AD', letterSpacing: 1 },
  save: {
    marginTop: spacing.md,
    backgroundColor: palette.ink,
    borderColor: palette.marigold,
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { ...typeScale.body, color: palette.marigold, fontWeight: '700' },
  missing: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.md },
});
