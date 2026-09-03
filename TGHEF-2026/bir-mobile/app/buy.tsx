import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { fetchAuthSession } from 'aws-amplify/auth';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  awaitOrderConfirmation,
  clearPendingOrder,
  fetchTicketTiers,
  ingestPassTokens,
  rememberPendingOrder,
  type TicketTier,
} from '@/features/tickets/purchase';
import { currentLocale } from '@/i18n';
import { kvStore } from '@/offline/db';
import { ensureFreshJwks } from '@/offline/jwks';
import { createOrder, getPaymentProvider } from '@/payments/provider';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, radius, spacing, typeScale } from '@/ui/tokens';

type FlowState = 'idle' | 'paying' | 'confirming' | 'stillPending' | 'failed' | 'cancelled';

/**
 * P3.1 buy flow. Order is created server-side; the checkout sheet result is
 * advisory — a ticket exists only after the webhook-driven onOrderConfirmed
 * delivers signed pass tokens (verified against the JWKS before storing).
 */
export default function Buy() {
  const { t } = useTranslation();
  const tiers = useQuery({ queryKey: ['ticketTiers'], queryFn: fetchTicketTiers });
  const [selected, setSelected] = useState<TicketTier | null>(null);
  const [state, setState] = useState<FlowState>('idle');

  const pay = async () => {
    if (!selected || state === 'paying' || state === 'confirming') return;
    setState('paying');
    try {
      const order = await createOrder({
        kind: 'ticket',
        itemId: selected.id,
        quantity: 1,
        idempotencyKey: `ticket:${selected.id}:${Date.now()}`,
      });
      // Persist BEFORE the sheet opens: if the app dies mid-payment, launch
      // recovery (resumePendingOrders) reconciles via getOrder.
      await rememberPendingOrder(kvStore, order.orderId, Date.now());

      const session = await fetchAuthSession();
      const phone = String(session.tokens?.idToken?.payload?.phone_number ?? '');
      const outcome = await getPaymentProvider().openCheckout(order, {
        phone,
        locale: currentLocale(),
      });

      if (outcome.state !== 'submitted') {
        // Leave the pending marker: a UPI payment can still land after a
        // dismissed sheet; recovery clears it once the backend says FAILED.
        setState(outcome.state === 'cancelled' ? 'cancelled' : 'failed');
        return;
      }

      setState('confirming');
      const confirmed = await awaitOrderConfirmation(order.orderId);
      const jwks = await ensureFreshJwks(kvStore, Date.now());
      await ingestPassTokens(confirmed.passTokens, jwks, Math.floor(Date.now() / 1000));
      await clearPendingOrder(kvStore, order.orderId);
      router.replace('/(visitor)/tickets');
    } catch (err) {
      const timedOut = err instanceof Error && err.message === 'order-confirmation-timeout';
      setState(timedOut ? 'stillPending' : 'failed');
    }
  };

  return (
    <Screen title={t('buy.title')}>
      {tiers.isPending ? (
        <View style={styles.center}>
          <ParagliderSpinner />
        </View>
      ) : (
        <FlatList
          data={tiers.data ?? []}
          keyExtractor={(tier) => tier.id}
          extraData={selected?.id}
          renderItem={({ item }) => {
            const title = currentLocale() === 'hi' && item.titleHi ? item.titleHi : item.titleEn;
            const active = selected?.id === item.id;
            return (
              <Pressable
                style={[styles.tier, active && styles.tierActive]}
                onPress={() => setSelected(item)}
                accessibilityRole="button"
                accessibilityLabel={title}
                accessibilityState={{ selected: active }}
              >
                <Text style={styles.tierTitle}>{title}</Text>
                <Text style={styles.tierPrice}>{t('buy.priceInr', { amount: item.priceInr })}</Text>
                {item.description ? <Text style={styles.tierDesc}>{item.description}</Text> : null}
              </Pressable>
            );
          }}
        />
      )}

      {state === 'confirming' || state === 'stillPending' ? (
        <View style={styles.statusBox}>
          {state === 'confirming' ? <ParagliderSpinner size={32} /> : null}
          <Text style={styles.statusText}>
            {state === 'confirming' ? t('buy.confirming') : t('buy.stillPending')}
          </Text>
          <Text style={styles.statusNote}>{t('buy.confirmNote')}</Text>
        </View>
      ) : null}
      {state === 'failed' ? <Text style={styles.error}>{t('buy.failed')}</Text> : null}
      {state === 'cancelled' ? <Text style={styles.error}>{t('buy.cancelled')}</Text> : null}

      {selected && state !== 'confirming' && state !== 'stillPending' ? (
        <View style={styles.methods}>
          <Text style={styles.methodsText}>{t('buy.methods')}</Text>
          <Text style={styles.securedText}>{t('buy.securedBy')}</Text>
        </View>
      ) : null}

      <Pressable
        style={[
          styles.payButton,
          (!selected || state === 'paying' || state === 'confirming') && styles.disabled,
        ]}
        onPress={pay}
        disabled={!selected || state === 'paying' || state === 'confirming'}
        accessibilityRole="button"
        accessibilityLabel={
          state === 'failed' || state === 'cancelled' ? t('buy.tryAgain') : t('buy.pay')
        }
      >
        <Text style={styles.payText}>
          {state === 'failed' || state === 'cancelled' ? t('buy.tryAgain') : t('buy.pay')}
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tier: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: '#FFFFFF',
    gap: spacing.xs,
  },
  tierActive: { borderColor: color.primary, borderWidth: 2 },
  tierTitle: { ...typeScale.heading, color: color.text },
  tierPrice: { ...typeScale.body, color: color.primary, fontWeight: '600' },
  tierDesc: { ...typeScale.caption, color: color.textMuted },
  statusBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  statusText: { ...typeScale.body, color: color.text },
  statusNote: { ...typeScale.caption, color: color.textMuted, textAlign: 'center' },
  error: { ...typeScale.body, color: color.danger, paddingVertical: spacing.sm },
  methods: { alignItems: 'center', gap: 2, marginBottom: spacing.sm },
  methodsText: { ...typeScale.caption, color: color.text, fontWeight: '600' },
  securedText: { ...typeScale.caption, color: color.textMuted, fontSize: 11 },
  payButton: {
    backgroundColor: color.primary,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  disabled: { opacity: 0.5 },
  payText: { ...typeScale.body, color: color.textInverse, fontWeight: '600' },
});
