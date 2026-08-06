import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { submitOtp } from '@/auth/otp';
import { tryDemoOtp } from '@/demo/demo';
import { demoDeps } from '@/demo/deps';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, radius, spacing, typeScale } from '@/ui/tokens';

export default function Otp() {
  const { t } = useTranslation();
  const { phone, mode } = useLocalSearchParams<{ phone: string; mode?: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demoFallback = mode === 'demo-fallback';

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      // Cognito unreachable/unconfigured → ONLY the demo code opens a
      // clearly-labelled demo session. Never consulted when SMS flow is live.
      const signedIn = demoFallback
        ? await tryDemoOtp(demoDeps(), code, Date.now())
        : await submitOtp(code);
      if (signedIn) router.replace('/(visitor)/home');
      else setError(t('auth.otpInvalid'));
    } catch {
      setError(t('auth.otpInvalid'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('auth.otpTitle')}>
      {demoFallback ? (
        <Text style={styles.demoHint}>{t('auth.demoHint')}</Text>
      ) : phone ? (
        <Text style={styles.sent}>{t('auth.otpSentTo', { phone })}</Text>
      ) : null}
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        maxLength={6}
        value={code}
        onChangeText={setCode}
        accessibilityLabel={t('auth.otpTitle')}
        autoFocus
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={[styles.button, (busy || code.length < 6) && { opacity: 0.6 }]}
        onPress={submit}
        disabled={busy || code.length < 6}
        accessibilityRole="button"
        accessibilityLabel={t('common.confirm')}
      >
        <Text style={styles.buttonText}>{t('common.confirm')}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sent: { ...typeScale.caption, color: color.textMuted, marginBottom: spacing.md },
  demoHint: { ...typeScale.caption, color: color.info, marginBottom: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
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
});
