import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { isEnabled } from '@/config/flags';
import { addToDeviceCalendar, eventWindow } from '@/features/highlights/calendar';
import { findItem, loadCatalog } from '@/features/highlights/catalog';
import {
  cancelRegistration,
  kvRegistrationStore,
  mergeRegistrations,
} from '@/features/highlights/registration';
import { fetchMyRegistrations } from '@/features/highlights/myRegistrations';
import type { RegistrationStatus } from '@/features/highlights/types';
import {
  shouldIssueBadge,
  setRegistrationBadge,
  type RegistrationWithBadge,
} from '@/features/badges/badges';
import { issueParticipantBadge } from '@/features/badges/issue';
import { issueDemoParticipantBadge } from '@/demo/demo';
import { savePass } from '@/features/tickets/passStore';
import { loadAllocation, loadPool, lodgingCardFor } from '@/features/lodging/allocation';
import { kvRoomStore } from '@/features/lodging/rooms';
import { pickLang } from '@/i18n';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { Screen } from '@/ui/Screen';
import { color, palette, radius, spacing, typeScale } from '@/ui/tokens';

const store = kvRegistrationStore(kvStore);
const outbox = new SqliteOutboxStore();

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
  const queryClient = useQueryClient();
  const [calendarNote, setCalendarNote] = useState<'added' | 'failed' | null>(null);
  // Local kv is the offline-safe base; when online the server-authoritative
  // myRegistrations (B1) merges over it so confirmations/waitlist promotions
  // made on another device appear here too.
  const registrations = useQuery({
    queryKey: ['registrations'],
    queryFn: async () => {
      const local = await store.list();
      try {
        const server = await fetchMyRegistrations(Date.now());
        return mergeRegistrations(local, server, Date.now());
      } catch {
        return local;
      }
    },
    networkMode: 'always',
  });
  const catalog = useQuery({
    queryKey: ['highlights', 'catalog'],
    queryFn: () => loadCatalog(kvStore, Date.now()),
    networkMode: 'always',
  });
  // CO-003: the lodging card appears once the hospitality desk commits.
  const allocation = useQuery({
    queryKey: ['lodging', 'allocation'],
    queryFn: () => loadAllocation(kvStore),
    networkMode: 'always',
  });
  const lodgingRooms = useQuery({
    queryKey: ['lodging', 'rooms'],
    queryFn: () => kvRoomStore(kvStore).list(),
    networkMode: 'always',
  });
  const lodgingPool = useQuery({
    queryKey: ['lodging', 'pool'],
    queryFn: () => loadPool().catch(() => []),
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
              {reg.status === 'cancelled' && reg.refundState && reg.refundState !== 'none' ? (
                <Text style={styles.refundNote}>
                  {reg.refundState === 'processed'
                    ? t('highlights.refundProcessed')
                    : t('highlights.refundPending')}
                </Text>
              ) : null}
              {(() => {
                const lodging = lodgingCardFor(
                  reg.id,
                  allocation.data ?? null,
                  lodgingRooms.data ?? [],
                  lodgingPool.data ?? [],
                );
                return lodging ? (
                  <View style={styles.lodgingCard}>
                    <Text style={styles.lodgingTitle}>{t('lodging.yourStay')}</Text>
                    <Text style={styles.lodgingBody}>
                      {lodging.hotelName} · {lodging.roomLabel} ·{' '}
                      {t(`lodging.type_${lodging.sharingType as 'twin'}`)}
                    </Text>
                    <Text style={styles.lodgingMeta}>
                      {t('lodging.checkInNote')}
                      {lodging.contactPhone ? ` · ${lodging.contactPhone}` : ''}
                    </Text>
                  </View>
                ) : null;
              })()}
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
              {shouldIssueBadge(reg, item, allocation.data ?? null) ? (
                <Pressable
                  style={styles.passLink}
                  onPress={async () => {
                    let jti = (reg as RegistrationWithBadge).badgeJti;
                    if (!jti) {
                      // Mock demo signs locally; live issues via the backend (B2d).
                      const issued = isEnabled('mockHighlights')
                        ? await issueDemoParticipantBadge(
                            { kv: kvStore, savePass },
                            { competitionId: reg.itemId, sub: reg.id },
                            Date.now(),
                          )
                        : await issueParticipantBadge(reg.id);
                      if (issued) {
                        await setRegistrationBadge(store, reg.id, issued);
                        await queryClient.invalidateQueries({ queryKey: ['registrations'] });
                        jti = issued;
                      }
                    }
                    if (jti) router.push({ pathname: '/badge/[jti]', params: { jti } });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('badge.open')}
                >
                  <Text style={styles.passLinkText}>{t('badge.open')} ›</Text>
                </Pressable>
              ) : null}
              {(reg.status === 'confirmed' || reg.status === 'waitlisted') && item ? (
                <View style={styles.actions}>
                  <Pressable
                    style={styles.action}
                    onPress={async () => {
                      const window = eventWindow(item, slot);
                      if (!window) return;
                      const ok = await addToDeviceCalendar({
                        title: pickLang(item.title, item.titleHi),
                        startDate: window.start,
                        endDate: window.end,
                        location: item.venue,
                      });
                      setCalendarNote(ok ? 'added' : 'failed');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('highlights.addToCalendar')}
                  >
                    <Text style={styles.actionText}>{t('highlights.addToCalendar')}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.action}
                    onPress={async () => {
                      const session = await fetchAuthSession().catch(() => null);
                      const sub = String(session?.tokens?.idToken?.payload?.sub ?? 'demo-user');
                      await cancelRegistration(
                        { outbox, store, mockMode: isEnabled('mockHighlights') },
                        { sub, registrationId: reg.id, paid: (item?.fee?.amount ?? 0) > 0 },
                        Date.now(),
                      );
                      await queryClient.invalidateQueries({ queryKey: ['registrations'] });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('highlights.cancel')}
                  >
                    <Text style={styles.actionText}>{t('highlights.cancel')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        }}
      />
      {calendarNote ? (
        <Text style={styles.calendarNote}>
          {calendarNote === 'added'
            ? t('highlights.calendarAdded')
            : t('highlights.calendarFailed')}
        </Text>
      ) : null}
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
  refundNote: { ...typeScale.caption, color: palette.pine, fontWeight: '600' },
  chip: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  chipOk: { backgroundColor: '#E4EEE8' },
  chipWarn: { backgroundColor: '#FCF3E3' },
  chipMuted: { backgroundColor: '#ECEFF1' },
  chipText: { fontSize: 10.5, fontWeight: '700', color: color.text },
  passLink: { marginTop: spacing.xs, minHeight: 32, justifyContent: 'center' },
  passLinkText: { ...typeScale.body, color: color.info, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  actionText: { ...typeScale.caption, color: color.text, fontWeight: '600' },
  calendarNote: { ...typeScale.caption, color: color.textMuted, textAlign: 'center', padding: 8 },
  lodgingCard: {
    marginTop: spacing.xs,
    backgroundColor: '#EAF3EE',
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 2,
  },
  lodgingTitle: { fontSize: 10.5, fontWeight: '700', color: palette.pine, letterSpacing: 0.5 },
  lodgingBody: { ...typeScale.caption, color: color.text, fontWeight: '600' },
  lodgingMeta: { fontSize: 11, color: color.textMuted },
});
