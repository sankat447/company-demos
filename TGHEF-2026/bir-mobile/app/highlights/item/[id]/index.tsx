import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { capacityState, findItem, loadCatalog } from '@/features/highlights/catalog';
import { requiresPayment } from '@/features/highlights/registration';
import { pickLang } from '@/i18n';
import { kvStore } from '@/offline/db';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * Item detail (CO-002 §3): summary, rules/eligibility, dates, fee, capacity
 * state, and ONE primary CTA driven by regMode. Category deltas allowed here:
 * competitions get "Rounds & judging" + a link to the voting surface (which
 * stays in Cultural Nights); nights render their agenda timeline.
 */
export default function ItemDetail() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const catalog = useQuery({
    queryKey: ['highlights', 'catalog'],
    queryFn: () => loadCatalog(kvStore, Date.now()),
    networkMode: 'always',
  });
  const item = catalog.data ? findItem(catalog.data, id) : null;

  if (catalog.isPending) {
    return (
      <Screen title={t('highlights.title')}>
        <View style={styles.center}>
          <ParagliderSpinner />
        </View>
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen title={t('highlights.title')}>
        <Text style={styles.muted}>{t('highlights.emptyCategory')}</Text>
      </Screen>
    );
  }

  const cap = capacityState(item);
  const paid = requiresPayment(item);
  const ctaLabel =
    item.regMode === 'register-participation'
      ? t('highlights.registerParticipation')
      : t('highlights.register');

  return (
    <Screen title={pickLang(item.title, item.titleHi)}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.summary}>{pickLang(item.summary, item.summaryHi)}</Text>
        <Text style={styles.meta}>
          {item.dates.join(' · ')}
          {item.venue ? `\n${item.venue}` : ''}
        </Text>

        <View style={styles.factsRow}>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>{t('highlights.fee')}</Text>
            <Text style={styles.factValue}>
              {paid ? `₹${item.fee!.amount}` : t('highlights.free')}
            </Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>{t('highlights.capacity')}</Text>
            <Text style={styles.factValue}>
              {cap.state === 'open'
                ? t('highlights.capOpen')
                : cap.state === 'waitlist'
                  ? t('highlights.capWaitlist')
                  : cap.state === 'view-only'
                    ? t('highlights.capViewOnly')
                    : cap.remaining === 0
                      ? t('highlights.capFull')
                      : t('highlights.capLeft', { n: cap.remaining })}
            </Text>
          </View>
        </View>

        {item.rules ? (
          <Section title={t('highlights.rules')}>
            <Text style={styles.body}>{pickLang(item.rules, item.rulesHi)}</Text>
          </Section>
        ) : null}
        {item.eligibility ? (
          <Section title={t('highlights.eligibility')}>
            <Text style={styles.body}>{pickLang(item.eligibility, item.eligibilityHi)}</Text>
          </Section>
        ) : null}

        {/* Competitions delta: rounds & judging + link to the voting surface */}
        {item.roundsJudging ? (
          <Section title={t('highlights.roundsJudging')}>
            <Text style={styles.body}>{pickLang(item.roundsJudging, item.roundsJudgingHi)}</Text>
            <Pressable
              style={styles.votingLink}
              onPress={() => router.push('/(visitor)/schedule')}
              accessibilityRole="button"
              accessibilityLabel={t('highlights.votingLink')}
            >
              <Text style={styles.votingLinkText}>{t('highlights.votingLink')} ›</Text>
            </Pressable>
          </Section>
        ) : null}

        {/* Cultural-nights delta: full agenda timeline, visible to everyone */}
        {item.agenda?.length ? (
          <Section title={t('highlights.agenda')}>
            {item.agenda.map((entry) => (
              <View key={`${entry.timeSec}`} style={styles.agendaRow}>
                <Text style={styles.agendaTime}>
                  {new Date(entry.timeSec * 1000).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                <Text style={styles.agendaTitle}>{pickLang(entry.title, entry.titleHi)}</Text>
              </View>
            ))}
          </Section>
        ) : null}

        {item.regMode !== 'view-only' ? (
          <Pressable
            style={styles.cta}
            onPress={() =>
              router.push({ pathname: '/highlights/item/[id]/register', params: { id: item.id } })
            }
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
          >
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </Pressable>
        ) : (
          <View style={styles.viewOnly}>
            <Text style={styles.viewOnlyText}>{t('highlights.viewOnlyNote')}</Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.md },
  scroll: { paddingBottom: spacing.xl },
  summary: { ...typeScale.body, color: color.text, lineHeight: 22 },
  meta: { ...typeScale.caption, color: color.textMuted, marginTop: spacing.sm, lineHeight: 18 },
  factsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  fact: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  factLabel: {
    fontSize: 10.5,
    color: color.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  factValue: { ...typeScale.heading, color: palette.pine, marginTop: 2 },
  section: { marginTop: spacing.lg },
  sectionTitle: { ...typeScale.heading, color: color.text, marginBottom: spacing.xs },
  body: { ...typeScale.caption, color: color.textMuted, lineHeight: 18 },
  votingLink: { marginTop: spacing.sm, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  votingLinkText: { ...typeScale.body, color: color.info, fontWeight: '600' },
  agendaRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: 6 },
  agendaTime: { ...typeScale.caption, color: palette.marigold, fontWeight: '700', width: 52 },
  agendaTitle: { ...typeScale.body, color: color.text, flex: 1 },
  cta: {
    marginTop: spacing.xl,
    backgroundColor: palette.ink,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET + 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.marigold,
  },
  ctaText: { ...typeScale.body, color: palette.marigold, fontWeight: '700' },
  viewOnly: {
    marginTop: spacing.xl,
    backgroundColor: '#ECEFF1',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  viewOnlyText: { ...typeScale.caption, color: color.textMuted, textAlign: 'center' },
});
