import NetInfo from '@react-native-community/netinfo';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { issueDemoActivityPass } from '@/demo/demo';
import { getFlyStatus } from '@/features/flight-status/flyStatus';
import { awaitOrderConfirmation, ingestPassTokens } from '@/features/tickets/purchase';
import { savePass } from '@/features/tickets/passStore';
import { findItem, loadCatalog } from '@/features/highlights/catalog';
import {
  beginPaidRegistration,
  fieldLabel,
  kvRegistrationStore,
  markRegistration,
  requiresPayment,
  submitFreeRegistration,
  validateForm,
  weatherBlocked,
  type FormError,
} from '@/features/highlights/registration';
import type { FormField, HighlightItem } from '@/features/highlights/types';
import { currentLocale, pickLang } from '@/i18n';
import { isEnabled } from '@/config/flags';
import { kvStore } from '@/offline/db';
import { ensureFreshJwks } from '@/offline/jwks';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { createOrder, getPaymentProvider } from '@/payments/provider';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const outbox = new SqliteOutboxStore();
const store = kvRegistrationStore(kvStore);

type FlowState = 'form' | 'submitting' | 'confirming' | 'done' | 'queued' | 'failed';

function Field({
  field,
  value,
  onChange,
  hasError,
}: {
  field: FormField;
  value: string;
  onChange(v: string): void;
  hasError: boolean;
}) {
  const locale = currentLocale();
  if (field.type === 'select') {
    return (
      <View style={styles.fieldWrap}>
        <Text style={styles.fieldLabel}>{fieldLabel(field, locale)}</Text>
        <View style={styles.options}>
          {(field.options ?? []).map((opt) => (
            <Pressable
              key={opt.value}
              style={[styles.option, value === opt.value && styles.optionOn]}
              onPress={() => onChange(opt.value)}
              accessibilityRole="button"
              accessibilityLabel={locale === 'hi' ? opt.labelHi : opt.label}
              accessibilityState={{ selected: value === opt.value }}
            >
              <Text style={[styles.optionText, value === opt.value && styles.optionTextOn]}>
                {locale === 'hi' ? opt.labelHi : opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {hasError ? <Text style={styles.fieldError}>{'*'}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{fieldLabel(field, locale)}</Text>
      <TextInput
        style={[styles.input, hasError && styles.inputError]}
        value={value}
        onChangeText={onChange}
        keyboardType={field.type === 'number' || field.type === 'phone' ? 'number-pad' : 'default'}
        accessibilityLabel={fieldLabel(field, locale)}
      />
    </View>
  );
}

/**
 * The standard registration flow (CO-002 §3) — identical for every item.
 * Form (server-driven schema + DPDP consent + guardian when flagged) →
 * fee step only when a fee exists (webhook-confirmed, never offline) →
 * confirmation. Free items queue in the outbox offline.
 */
export default function Register() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: ['highlights', 'catalog'],
    queryFn: () => loadCatalog(kvStore, Date.now()),
    networkMode: 'always',
  });
  const item = catalog.data ? findItem(catalog.data, id) : null;

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [slotId, setSlotId] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<FormError[]>([]);
  const [state, setState] = useState<FlowState>('form');
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((s) => setOnline(s.isConnected === true));
    return unsubscribe;
  }, []);

  // CO-002 paragliding delta: the official hold gates weather-sensitive CTAs.
  const fly = useQuery({
    queryKey: ['flyStatus'],
    queryFn: () => getFlyStatus(kvStore),
    networkMode: 'always',
    staleTime: 30_000,
  });

  if (!item) {
    return (
      <Screen title={t('highlights.title')}>
        <Text style={styles.muted}>{t('highlights.emptyCategory')}</Text>
      </Screen>
    );
  }

  const paid = requiresPayment(item);
  const mockMode = isEnabled('mockHighlights');
  const paidBlocked = paid && (!online || mockMode);
  const weatherHold = weatherBlocked(item, fly.data?.state ?? null);

  const submit = async (target: HighlightItem) => {
    const input = { answers, consent, guardianConsent };
    const found = validateForm(target, input, target.slots?.length ? slotId : undefined);
    setErrors(found);
    if (found.length) return;

    setState('submitting');
    try {
      const session = await fetchAuthSession().catch(() => null);
      const sub = String(session?.tokens?.idToken?.payload?.sub ?? 'demo-user');

      if (!paid) {
        const registration = await submitFreeRegistration(
          { outbox, store, mockMode },
          { sub, item: target, slotId, answers },
          Date.now(),
        );
        // Demo-only: mock-confirmed gate-checked items get a locally-signed
        // activity pass so the wallet + verifier path demos end-to-end.
        if (mockMode && target.gateChecked) {
          const jti = await issueDemoActivityPass(
            { kv: kvStore, savePass },
            { itemId: target.id, slotId, sub },
            Date.now(),
          );
          if (jti) await markRegistration(store, registration.id, 'confirmed', jti);
        }
        setState(online ? 'done' : 'queued');
      } else {
        // Webhook-confirmed order pattern — never faked, never offline.
        const { registration, orderInput } = await beginPaidRegistration(
          { outbox, store, mockMode },
          { sub, item: target, slotId, answers },
          Date.now(),
        );
        const order = await createOrder(orderInput);
        const phone = String(session?.tokens?.idToken?.payload?.phone_number ?? '');
        const outcome = await getPaymentProvider().openCheckout(order, {
          phone,
          locale: currentLocale(),
        });
        if (outcome.state !== 'submitted') {
          setState('failed');
          return;
        }
        setState('confirming');
        const confirmed = await awaitOrderConfirmation(order.orderId);
        let qrPassJti: string | undefined;
        if (confirmed.passTokens.length) {
          const jwks = await ensureFreshJwks(kvStore, Date.now());
          const claims = await ingestPassTokens(
            confirmed.passTokens,
            jwks,
            Math.floor(Date.now() / 1000),
          );
          qrPassJti = claims[0]?.jti;
        }
        await markRegistration(store, registration.id, 'confirmed', qrPassJti);
        setState('done');
      }
      await queryClient.invalidateQueries({ queryKey: ['registrations'] });
    } catch {
      setState('failed');
    }
  };

  const ctaLabel =
    item.regMode === 'register-participation'
      ? t('highlights.registerParticipation')
      : t('highlights.register');
  const hasError = (key: string) => errors.some((e) => e.field === key);

  return (
    <Screen title={pickLang(item.title, item.titleHi)}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {state === 'done' || state === 'queued' ? (
          <View style={styles.doneBox}>
            <Text style={styles.doneTitle}>
              {state === 'queued' ? t('highlights.queuedTitle') : t('highlights.doneTitle')}
            </Text>
            <Text style={styles.doneBody}>
              {state === 'queued' ? t('highlights.queuedBody') : t('highlights.doneBody')}
            </Text>
            <Pressable
              style={styles.cta}
              onPress={() => router.push('/highlights/my')}
              accessibilityRole="button"
              accessibilityLabel={t('highlights.myRegistrations')}
            >
              <Text style={styles.ctaText}>{t('highlights.myRegistrations')}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {(item.formSchema ?? []).map((field) => (
              <Field
                key={field.key}
                field={field}
                value={answers[field.key] ?? ''}
                onChange={(v) => setAnswers({ ...answers, [field.key]: v })}
                hasError={hasError(field.key)}
              />
            ))}

            {/* CO-002 slot mechanism: paragliding pilot windows, tour departures */}
            {item.slots?.length ? (
              <View style={styles.fieldWrap}>
                <Text style={[styles.fieldLabel, hasError('_slot') && styles.errorText]}>
                  {t('highlights.pickSlot')}
                </Text>
                <View style={styles.options}>
                  {item.slots.map((slot) => {
                    const full = (slot.remaining ?? 1) <= 0;
                    return (
                      <Pressable
                        key={slot.id}
                        style={[
                          styles.option,
                          slotId === slot.id && styles.optionOn,
                          full && styles.optionOff,
                        ]}
                        disabled={full}
                        onPress={() => setSlotId(slot.id)}
                        accessibilityRole="button"
                        accessibilityLabel={pickLang(slot.label ?? slot.id, slot.labelHi)}
                        accessibilityState={{ selected: slotId === slot.id, disabled: full }}
                      >
                        <Text
                          style={[styles.optionText, slotId === slot.id && styles.optionTextOn]}
                        >
                          {pickLang(slot.label ?? slot.id, slot.labelHi)}
                          {full
                            ? ` · ${t('highlights.capFull')}`
                            : slot.remaining !== undefined
                              ? ` · ${t('highlights.capLeft', { n: slot.remaining })}`
                              : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={styles.consentRow}>
              <Switch
                value={consent}
                onValueChange={setConsent}
                accessibilityLabel={t('highlights.consent')}
                trackColor={{ true: color.primary, false: color.cardBorder }}
              />
              <Text style={[styles.consentText, hasError('_consent') && styles.errorText]}>
                {t('highlights.consent')}
              </Text>
            </View>
            {item.guardianRequired ? (
              <View style={styles.consentRow}>
                <Switch
                  value={guardianConsent}
                  onValueChange={setGuardianConsent}
                  accessibilityLabel={t('highlights.guardianConsent')}
                  trackColor={{ true: color.primary, false: color.cardBorder }}
                />
                <Text style={[styles.consentText, hasError('_guardian') && styles.errorText]}>
                  {t('highlights.guardianConsent')}
                </Text>
              </View>
            ) : null}

            {paid ? (
              <Text style={styles.feeNote}>
                {t('highlights.feeNote', { amount: item.fee!.amount })}
              </Text>
            ) : null}
            {paidBlocked ? (
              <View style={styles.blocker}>
                <Text style={styles.blockerText}>
                  {mockMode ? t('highlights.paidMockBlocked') : t('highlights.paidOffline')}
                </Text>
              </View>
            ) : null}
            {weatherHold ? (
              <View style={styles.blocker}>
                <Text style={styles.blockerText}>
                  {t('home.flyHold')} {t('home.flyRefundAuto')}
                </Text>
              </View>
            ) : null}
            {state === 'failed' ? (
              <Text style={styles.errorText}>
                {paid ? t('buy.failed') : t('highlights.regFailed')}
              </Text>
            ) : null}
            {errors.length ? (
              <Text style={styles.errorText}>{t('highlights.formErrors')}</Text>
            ) : null}

            <Pressable
              style={[
                styles.cta,
                (state === 'submitting' || state === 'confirming' || paidBlocked || weatherHold) &&
                  styles.ctaDisabled,
              ]}
              disabled={
                state === 'submitting' || state === 'confirming' || paidBlocked || weatherHold
              }
              onPress={() => submit(item)}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
            >
              <Text style={styles.ctaText}>
                {state === 'confirming' ? t('buy.confirming') : ctaLabel}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.md },
  scroll: { paddingBottom: spacing.xl },
  fieldWrap: { marginBottom: spacing.md },
  fieldLabel: { ...typeScale.caption, color: color.text, fontWeight: '600', marginBottom: 6 },
  fieldError: { color: color.danger },
  input: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    ...typeScale.body,
    color: color.text,
    backgroundColor: '#FFFFFF',
  },
  inputError: { borderColor: color.danger },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.cardBorder,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionOn: { borderColor: palette.pine, backgroundColor: '#E4EEE8' },
  optionOff: { opacity: 0.45 },
  optionText: { ...typeScale.body, color: color.text },
  optionTextOn: { color: palette.pine, fontWeight: '600' },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  consentText: { ...typeScale.caption, color: color.textMuted, flex: 1, lineHeight: 17 },
  feeNote: { ...typeScale.body, color: palette.pine, fontWeight: '600', marginTop: spacing.sm },
  blocker: {
    marginTop: spacing.sm,
    backgroundColor: '#FCF3E3',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  blockerText: { ...typeScale.caption, color: color.text, lineHeight: 17 },
  errorText: { ...typeScale.caption, color: color.danger, marginTop: spacing.xs },
  cta: {
    marginTop: spacing.lg,
    backgroundColor: palette.ink,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET + 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.marigold,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { ...typeScale.body, color: palette.marigold, fontWeight: '700' },
  doneBox: { paddingTop: spacing.lg, gap: spacing.sm },
  doneTitle: { ...typeScale.title, color: palette.pine },
  doneBody: { ...typeScale.body, color: color.textMuted, lineHeight: 21 },
});
