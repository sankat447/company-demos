import { useQuery } from '@tanstack/react-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { loadHospitalityConsole } from '@/features/partner/console';
import { checkInGuest, occupancySummary, type Allocation } from '@/features/partner/partner';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const outbox = new SqliteOutboxStore();

/** P5.3 hospitality partner console: allocations, check-in flow, occupancy
 *  board — renders offline from cache (ARCHITECTURE §3). Check-in persists via
 *  the outbox (partnerCheckIn) and merges back on load, so it survives reload
 *  and other devices; local overrides give immediate feedback meanwhile. */
export default function Hospitality() {
  const { t } = useTranslation();
  const console_ = useQuery({
    queryKey: ['partner', 'hospitality'],
    queryFn: loadHospitalityConsole,
    networkMode: 'always',
  });
  // regId -> intended checkedIn (overrides the server value until the next load).
  const [override, setOverride] = useState<Map<string, boolean>>(new Map());

  const c = console_.data;
  const isIn = (a: Allocation) => (override.has(a.regId) ? override.get(a.regId)! : a.checkedIn);
  const summary = c
    ? occupancySummary({
        ...c,
        allocations: c.allocations.map((a) => ({ ...a, checkedIn: isIn(a) })),
      })
    : null;

  const toggle = async (a: Allocation) => {
    const target = !isIn(a);
    const next = new Map(override);
    next.set(a.regId, target);
    setOverride(next);
    const session = await fetchAuthSession().catch(() => null);
    const sub = String(session?.tokens?.idToken?.payload?.sub ?? 'demo-user');
    await checkInGuest(outbox, { sub, regId: a.regId, checkedIn: target }, Date.now());
  };

  return (
    <Screen title={t('tabs.hospitality')}>
      {c ? (
        <>
          <Text style={styles.hotel}>{c.hotelName}</Text>
          <Text style={styles.tier}>{c.tier}</Text>
          {summary ? (
            <View style={styles.board}>
              <Text style={styles.boardText}>
                {t('partner.checkedInCount', { done: summary.checkedIn, total: summary.total })}
              </Text>
              <Text style={styles.boardSub}>
                {t('partner.complimentary', { n: c.complimentaryRooms })}
              </Text>
            </View>
          ) : null}
          <FlatList
            data={c.allocations}
            keyExtractor={(a) => a.regId}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={styles.rowBody}>
                  <Text style={styles.guest}>{item.guestName}</Text>
                  <Text style={styles.roomMeta}>
                    {item.roomLabel} · {item.nights.map((n) => n.slice(8)).join(',')} Nov
                  </Text>
                </View>
                <Pressable
                  style={[styles.checkBtn, isIn(item) && styles.checkBtnDone]}
                  onPress={() => void toggle(item)}
                  accessibilityRole="button"
                  accessibilityLabel={isIn(item) ? t('partner.checkedIn') : t('partner.checkIn')}
                >
                  <Text style={[styles.checkText, isIn(item) && styles.checkTextDone]}>
                    {isIn(item) ? t('partner.checkedIn') : t('partner.checkIn')}
                  </Text>
                </Pressable>
              </View>
            )}
          />
        </>
      ) : (
        <Text style={styles.muted}>{t('common.offlineBanner')}</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hotel: { ...typeScale.title, color: color.text },
  tier: { ...typeScale.caption, color: color.textMuted, marginTop: 2 },
  board: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: palette.ink,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  boardText: { ...typeScale.body, color: palette.marigold, fontWeight: '700', textAlign: 'center' },
  boardSub: { ...typeScale.caption, color: '#C6DDCB', textAlign: 'center', marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: '#FFFFFF',
  },
  rowBody: { flex: 1 },
  guest: { ...typeScale.body, color: color.text, fontWeight: '600' },
  roomMeta: { ...typeScale.caption, color: color.textMuted, marginTop: 1 },
  checkBtn: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBtnDone: { backgroundColor: '#E4EEE8', borderColor: '#CBE0D3' },
  checkText: { ...typeScale.caption, color: color.primary, fontWeight: '600' },
  checkTextDone: { color: palette.pine },
  muted: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.md },
});
