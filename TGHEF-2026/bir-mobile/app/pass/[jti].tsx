import { useQuery } from '@tanstack/react-query';
import * as Brightness from 'expo-brightness';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { getPass } from '@/features/tickets/passStore';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { Screen } from '@/ui/Screen';
import { color, palette, radius, spacing, typeScale } from '@/ui/tokens';

/**
 * The QR pass screen (P3.1): wallet-style card, brightness bump while
 * visible, rendered entirely from SQLite — works with airplane mode on.
 */
export default function PassScreen() {
  const { t } = useTranslation();
  const { jti } = useLocalSearchParams<{ jti: string }>();
  const pass = useQuery({
    queryKey: ['pass', jti],
    queryFn: () => getPass(jti),
    enabled: !!jti,
    networkMode: 'always',
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

  return (
    <Screen title={t('tickets.showAtGate')}>
      {pass.isPending ? (
        <View style={styles.center}>
          <ParagliderSpinner />
        </View>
      ) : pass.data ? (
        <View style={styles.card}>
          <View style={styles.qrWrap}>
            <QRCode value={pass.data.token} size={260} backgroundColor="#FFFFFF" />
          </View>
          <Text style={styles.evt}>{pass.data.claims.evt}</Text>
          <Text style={styles.zones}>{pass.data.claims.zones.join(' · ')}</Text>
          <Text style={styles.offline}>{t('tickets.worksOffline')}</Text>
        </View>
      ) : (
        <Text style={styles.missing}>{t('tickets.empty')}</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    alignItems: 'center',
    backgroundColor: palette.ink,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  qrWrap: { backgroundColor: '#FFFFFF', padding: spacing.md, borderRadius: radius.md },
  evt: { ...typeScale.heading, color: color.textInverse, marginTop: spacing.sm },
  zones: { ...typeScale.caption, color: palette.marigold },
  offline: { ...typeScale.caption, color: color.textInverse, opacity: 0.7 },
  missing: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.lg },
});
