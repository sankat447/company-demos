import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { submitOtp } from '@/auth/otp';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, radius, spacing, typeScale } from '@/ui/tokens';

export default function Otp() {
  const { t } = useTranslation();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const signedIn = await submitOtp(code);
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
      {phone ? <Text style={styles.sent}>{t('auth.otpSentTo', { phone })}</Text> : null}
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
