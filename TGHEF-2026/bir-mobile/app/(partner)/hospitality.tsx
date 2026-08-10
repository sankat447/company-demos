import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  loadHospitalityConsole,
  occupancySummary,
  type Allocation,
} from '@/features/partner/partner';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

/** P5.3 hospitality partner console: allocations, check-in flow, occupancy
 *  board — renders offline from cache (ARCHITECTURE §3). Check-in is local
 *  UI state here; the mutation lands with the backend allocations API. */
export default function Hospitality() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const console_ = useQuery({
    queryKey: ['partner', 'hospitality'],
    queryFn: loadHospitalityConsole,
    networkMode: 'always',
  });
  const [checkedIn, setCheckedIn] = useState<Set<string>>(new Set());

  const c = console_.data;
  const isIn = (a: Allocation) => a.checkedIn || checkedIn.has(a.regId);
  const summary = c
    ? occupancySummary({
        ...c,
        allocations: c.allocations.map((a) => ({ ...a, checkedIn: isIn(a) })),
      })
    : null;

  const toggle = (regId: string) => {
    const next = new Set(checkedIn);
    next.has(regId) ? next.delete(regId) : next.add(regId);
    setCheckedIn(next);
    void queryClient.invalidateQueries({ queryKey: ['partner', 'hospitality'] });
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
                  onPress={() => toggle(item.regId)}
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
