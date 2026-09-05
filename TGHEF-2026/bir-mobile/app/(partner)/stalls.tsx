import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { loadStallConsole } from '@/features/partner/console';
import { STALL_STAGES, stallProgress } from '@/features/partner/partner';
import { pickLang } from '@/i18n';
import { Screen } from '@/ui/Screen';
import { color, radius, spacing, typeScale, palette } from '@/ui/tokens';

/** P5.2 partner food-stall console: application status, allocation, payment,
 *  daily analytics, food-street rules. Read-mostly mirror of backend state. */
export default function Stalls() {
  const { t } = useTranslation();
  const stall = useQuery({
    queryKey: ['partner', 'stall'],
    queryFn: loadStallConsole,
    networkMode: 'always',
  });
  const s = stall.data;

  return (
    <Screen title={t('tabs.stalls')}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {s ? (
          <>
            <Text style={styles.name}>{s.stallName}</Text>
            <Text style={styles.category}>{s.category}</Text>

            {/* application pipeline */}
            <View style={styles.pipeline}>
              {STALL_STAGES.map((stage) => {
                const active = stallProgress(s.stage) >= stallProgress(stage);
                return (
                  <View key={stage} style={styles.step}>
                    <View style={[styles.dot, active && styles.dotOn]} />
                    <Text style={[styles.stepText, active && styles.stepTextOn]}>
                      {t(`partner.stage_${stage}`)}
                    </Text>
                  </View>
                );
              })}
            </View>

            {s.allocationLabel ? (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>{t('partner.allocation')}</Text>
                <Text style={styles.cardValue}>{s.allocationLabel}</Text>
              </View>
            ) : null}

            {s.feeInr ? (
              <View style={[styles.card, s.paid ? styles.paidCard : styles.dueCard]}>
                <Text style={styles.cardLabel}>{t('partner.fee')}</Text>
                <Text style={styles.cardValue}>
                  ₹{s.feeInr} · {s.paid ? t('partner.paid') : t('partner.paymentDue')}
                </Text>
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>{t('partner.analytics')}</Text>
            {s.analytics.map((a) => (
              <View key={a.day} style={styles.analyticsRow}>
                <Text style={styles.analyticsDay}>{a.day.slice(8)} Nov</Text>
                <Text style={styles.analyticsMeta}>
                  {t('partner.orders', { n: a.ordersEstimate })} ·{' '}
                  {t('partner.footfall', { n: a.footfallIndex })}
                </Text>
              </View>
            ))}

            <Text style={styles.sectionTitle}>{t('partner.foodRules')}</Text>
            {s.rules.map((rule, i) => (
              <Text key={i} style={styles.rule}>
                • {pickLang(rule, s.rulesHi[i])}
              </Text>
            ))}
          </>
        ) : (
          <Text style={styles.muted}>{t('common.offlineBanner')}</Text>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  name: { ...typeScale.title, color: color.text },
  category: { ...typeScale.caption, color: color.textMuted, marginTop: 2 },
  pipeline: { marginTop: spacing.md, gap: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: color.cardBorder },
  dotOn: { backgroundColor: palette.pine },
  stepText: { ...typeScale.caption, color: color.textMuted },
  stepTextOn: { color: color.text, fontWeight: '600' },
  card: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
  },
  dueCard: { backgroundColor: '#FCF3E3', borderColor: '#EAD9B0' },
  paidCard: { backgroundColor: '#E4EEE8', borderColor: '#CBE0D3' },
  cardLabel: {
    fontSize: 10.5,
    color: color.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cardValue: { ...typeScale.body, color: color.text, fontWeight: '600', marginTop: 2 },
  sectionTitle: {
    ...typeScale.heading,
    color: color.text,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  analyticsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF2EE',
  },
  analyticsDay: { ...typeScale.body, color: color.text, fontWeight: '600' },
  analyticsMeta: { ...typeScale.caption, color: color.textMuted },
  rule: { ...typeScale.caption, color: color.textMuted, lineHeight: 19, marginBottom: 2 },
  muted: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.md },
});
