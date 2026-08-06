import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { findItem, loadCatalog } from '@/features/highlights/catalog';
import { pickLang } from '@/i18n';
import { kvStore } from '@/offline/db';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { Screen } from '@/ui/Screen';
import { color, spacing, typeScale } from '@/ui/tokens';

/** PR-2 stub: title + summary only. PR-3 (P5.7) adds rules, slots, fee,
 *  capacity state and the standard registration CTA. */
export default function ItemDetail() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const catalog = useQuery({
    queryKey: ['highlights', 'catalog'],
    queryFn: () => loadCatalog(kvStore, Date.now()),
    networkMode: 'always',
  });
  const item = catalog.data ? findItem(catalog.data, id) : null;

  return (
    <Screen title={item ? pickLang(item.title, item.titleHi) : t('highlights.title')}>
      {catalog.isPending ? (
        <View style={styles.center}>
          <ParagliderSpinner />
        </View>
      ) : item ? (
        <Text style={styles.summary}>{pickLang(item.summary, item.summaryHi)}</Text>
      ) : (
        <Text style={styles.summary}>{t('highlights.emptyCategory')}</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summary: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.md },
});
