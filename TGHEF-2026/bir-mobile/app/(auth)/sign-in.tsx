import { router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { normalizePhone, requestOtp } from '@/auth/otp';
import { toggleLocale } from '@/i18n';
import { FlightLineDivider } from '@/ui/FlightLineDivider';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, radius, spacing, typeScale } from '@/ui/tokens';

export default function SignIn() {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const normalized = normalizePhone(phone);
      await requestOtp(normalized);
      router.push({ pathname: '/(auth)/otp', params: { phone: normalized } });
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'invalid-phone'
          ? t('auth.phonePlaceholder')
          : t('auth.otpOffline'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.brand}>{t('app.name')}</Text>
        <FlightLineDivider />
        <Text style={styles.tagline}>{t('app.tagline')}</Text>
      </View>

      <Text style={styles.label}>{t('auth.phoneTitle')}</Text>
      <TextInput
        style={styles.input}
        keyboardType="phone-pad"
        placeholder={t('auth.phonePlaceholder')}
        placeholderTextColor={color.textMuted}
        value={phone}
        onChangeText={setPhone}
        accessibilityLabel={t('auth.phonePlaceholder')}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, busy && { opacity: 0.6 }]}
        onPress={submit}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('auth.sendOtp')}
      >
        <Text style={styles.buttonText}>{t('auth.sendOtp')}</Text>
      </Pressable>

      <Pressable
        style={styles.localeSwitch}
        onPress={toggleLocale}
        accessibilityRole="button"
        accessibilityLabel={t('common.languageSwitch')}
      >
        <Text style={styles.localeText}>{t('common.languageSwitch')}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  brand: { ...typeScale.display, color: color.text },
  tagline: { ...typeScale.caption, color: color.textMuted },
  label: { ...typeScale.heading, color: color.text, marginBottom: spacing.sm },
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
  error: { ...typeScale.caption, color: color.danger, marginTop: spacing.xs },
  button: {
    marginTop: spacing.lg,
    backgroundColor: color.primary,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { ...typeScale.body, color: color.textInverse, fontWeight: '600' },
  localeSwitch: {
    marginTop: spacing.xl,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  localeText: { ...typeScale.body, color: color.info },
});
