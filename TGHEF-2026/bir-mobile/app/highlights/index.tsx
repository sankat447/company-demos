import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { loadCatalog, sortedCategories } from '@/features/highlights/catalog';
import { pickLang } from '@/i18n';
import { kvStore } from '@/offline/db';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { Screen } from '@/ui/Screen';
import { color, palette, spacing, typeScale } from '@/ui/tokens';

const INK_TWO = '#20313B';

/**
 * CO-002 category hub: every festival function is one tap deeper from here.
 * Rows render whatever the server-driven catalog publishes.
 */
export default function HighlightsHub() {
  const { t } = useTranslation();
  const catalog = useQuery({
    queryKey: ['highlights', 'catalog'],
    queryFn: () => loadCatalog(kvStore, Date.now()),
    networkMode: 'always',
  });

  return (
    <Screen title={t('highlights.title')}>
      {catalog.isPending ? (
        <View style={styles.center}>
          <ParagliderSpinner />
        </View>
      ) : catalog.isError ? (
        <Text style={styles.error}>{t('highlights.unavailable')}</Text>
      ) : (
        <FlatList
          data={sortedCategories(catalog.data)}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/highlights/[category]', params: { category: item.id } })
              }
              accessibilityRole="button"
              accessibilityLabel={pickLang(item.title, item.titleHi)}
            >
              <LinearGradient
                colors={[palette.ink, INK_TWO]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.7 }}
                style={styles.row}
              >
                <View style={styles.icon}>
                  <Text style={styles.iconText}>{item.icon}</Text>
                </View>
                <View style={styles.body}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowSub}>{item.titleHi}</Text>
                </View>
                <View style={styles.chev}>
                  <Text style={styles.chevText}>›</Text>
                </View>
              </LinearGradient>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 18,
    marginBottom: spacing.sm + 2,
    borderWidth: 1,
    borderColor: 'rgba(232,161,61,0.35)',
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(232,161,61,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(232,161,61,0.45)',
  },
  iconText: { fontSize: 22 },
  body: { flex: 1 },
  rowTitle: { fontFamily: 'Fraunces_600SemiBold', fontSize: 17, color: '#FFFFFF' },
  rowSub: { fontSize: 11.5, color: '#C9D6CE', marginTop: 2 },
  chev: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: palette.marigold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevText: { color: palette.ink, fontWeight: '800', fontSize: 15, marginTop: -2 },
});
