import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { findItem, loadCatalog } from '@/features/highlights/catalog';
import { kvRegistrationStore } from '@/features/highlights/registration';
import type { RegistrationStatus } from '@/features/highlights/types';
import { pickLang } from '@/i18n';
import { kvStore } from '@/offline/db';
import { Screen } from '@/ui/Screen';
import { color, palette, radius, spacing, typeScale } from '@/ui/tokens';

const store = kvRegistrationStore(kvStore);

const STATUS_KEY: Record<RegistrationStatus, string> = {
  draft: 'highlights.stDraft',
  'pending-payment': 'highlights.stPendingPayment',
  'pending-sync': 'highlights.stPendingSync',
  confirmed: 'highlights.stConfirmed',
  waitlisted: 'highlights.stWaitlisted',
  cancelled: 'highlights.stCancelled',
};

/** My Registrations (P5.9): renders offline from the kv store; confirmed
 *  gate-checked entries link to their QR pass in the shared wallet. */
export default function MyRegistrations() {
  const { t } = useTranslation();
  const registrations = useQuery({
    queryKey: ['registrations'],
    queryFn: () => store.list(),
    networkMode: 'always',
  });
  const catalog = useQuery({
    queryKey: ['highlights', 'catalog'],
    queryFn: () => loadCatalog(kvStore, Date.now()),
    networkMode: 'always',
  });

  return (
    <Screen title={t('highlights.myRegistrations')}>
      <FlatList
        data={(registrations.data ?? []).sort((a, b) => b.createdAtMs - a.createdAtMs)}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={<Text style={styles.empty}>{t('highlights.myEmpty')}</Text>}
        renderItem={({ item: reg }) => {
          const item = catalog.data ? findItem(catalog.data, reg.itemId) : null;
          const slot = item?.slots?.find((s) => s.id === reg.slotId);
          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>
                  {item ? pickLang(item.title, item.titleHi) : reg.itemId}
                </Text>
                <View
                  style={[
                    styles.chip,
                    reg.status === 'confirmed'
                      ? styles.chipOk
                      : reg.status === 'cancelled'
                        ? styles.chipMuted
                        : styles.chipWarn,
                  ]}
                >
                  <Text style={styles.chipText}>{t(STATUS_KEY[reg.status])}</Text>
                </View>
              </View>
              {slot ? (
                <Text style={styles.cardMeta}>{pickLang(slot.label ?? '', slot.labelHi)}</Text>
              ) : null}
              {reg.status === 'pending-sync' ? (
                <Text style={styles.pendingNote}>{t('highlights.queuedBody')}</Text>
              ) : null}
              {reg.qrPassJti ? (
                <Pressable
                  style={styles.passLink}
                  onPress={() =>
                    router.push({ pathname: '/pass/[jti]', params: { jti: reg.qrPassJti! } })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={t('highlights.openPass')}
                >
                  <Text style={styles.passLinkText}>{t('highlights.openPass')} ›</Text>
                </Pressable>
              ) : null}
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.lg },
  card: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: '#FFFFFF',
    gap: spacing.xs,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { ...typeScale.heading, color: color.text, flex: 1 },
  cardMeta: { ...typeScale.caption, color: color.textMuted },
  pendingNote: { ...typeScale.caption, color: palette.slate },
  chip: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  chipOk: { backgroundColor: '#E4EEE8' },
  chipWarn: { backgroundColor: '#FCF3E3' },
  chipMuted: { backgroundColor: '#ECEFF1' },
  chipText: { fontSize: 10.5, fontWeight: '700', color: color.text },
  passLink: { marginTop: spacing.xs, minHeight: 32, justifyContent: 'center' },
  passLinkText: { ...typeScale.body, color: color.info, fontWeight: '600' },
});
