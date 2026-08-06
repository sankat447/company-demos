import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { capacityState, itemsForCategory, loadCatalog } from '@/features/highlights/catalog';
import type { CapacityState } from '@/features/highlights/catalog';
import { pickLang } from '@/i18n';
import { kvStore } from '@/offline/db';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { Screen } from '@/ui/Screen';
import { color, palette, radius, spacing, typeScale } from '@/ui/tokens';

function CapacityChip({ cap }: { cap: CapacityState }) {
  const { t } = useTranslation();
  const label =
    cap.state === 'open'
      ? t('highlights.capOpen')
      : cap.state === 'waitlist'
        ? t('highlights.capWaitlist')
        : cap.state === 'view-only'
          ? t('highlights.capViewOnly')
          : cap.remaining === 0
            ? t('highlights.capFull')
            : t('highlights.capLeft', { n: cap.remaining });
  const tone =
    cap.state === 'waitlist' || (cap.state === 'left' && cap.remaining === 0)
      ? styles.chipWarn
      : cap.state === 'view-only'
        ? styles.chipMuted
        : styles.chipOk;
  return (
    <View style={[styles.chip, tone]}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

/** Item list within a category — card rows with capacity chip (CO-002 §5). */
export default function CategoryScreen() {
  const { t } = useTranslation();
  const { category } = useLocalSearchParams<{ category: string }>();
  const catalog = useQuery({
    queryKey: ['highlights', 'catalog'],
    queryFn: () => loadCatalog(kvStore, Date.now()),
    networkMode: 'always',
  });

  const meta = catalog.data?.categories.find((c) => c.id === category);
  const items = catalog.data ? itemsForCategory(catalog.data, category) : [];

  return (
    <Screen title={meta ? pickLang(meta.title, meta.titleHi) : t('highlights.title')}>
      {catalog.isPending ? (
        <View style={styles.center}>
          <ParagliderSpinner />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.empty}>{t('highlights.emptyCategory')}</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() =>
                router.push({ pathname: '/highlights/item/[id]', params: { id: item.id } })
              }
              accessibilityRole="button"
              accessibilityLabel={pickLang(item.title, item.titleHi)}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{pickLang(item.title, item.titleHi)}</Text>
                <CapacityChip cap={capacityState(item)} />
              </View>
              <Text style={styles.cardSummary}>{pickLang(item.summary, item.summaryHi)}</Text>
              <Text style={styles.cardMeta}>
                {item.venue ? `${item.venue} · ` : ''}
                {item.fee ? `₹${item.fee.amount}` : t('highlights.free')}
              </Text>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  cardSummary: { ...typeScale.caption, color: color.textMuted, lineHeight: 17 },
  cardMeta: { ...typeScale.caption, color: palette.pine, fontWeight: '600' },
  chip: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  chipOk: { backgroundColor: '#E4EEE8' },
  chipWarn: { backgroundColor: '#FCF3E3' },
  chipMuted: { backgroundColor: '#ECEFF1' },
  chipText: { fontSize: 10.5, fontWeight: '700', color: color.text },
});
