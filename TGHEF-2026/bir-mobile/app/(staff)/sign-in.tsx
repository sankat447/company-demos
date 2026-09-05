import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminLogin } from '@/auth/adminAuth';
import { clearMode } from '@/mode/mode';
import { AlpineBackdrop } from '@/ui/AlpineBackdrop';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

/**
 * Staff sign-in — the SAME username/password 4-tier admin credentials as the
 * web ops console (no OTP). On success the app enters Staff mode.
 */
export default function StaffSignIn() {
  const { t } = useTranslation();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await adminLogin(username, password);
      router.replace('/(staff)/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const backToPicker = async () => {
    await clearMode();
    router.replace('/');
  };

  return (
    <View style={styles.root}>
      <AlpineBackdrop height={Dimensions.get('window').height} />
      <View style={styles.content}>
        <Text style={styles.mark}>🛂</Text>
        <Text style={styles.title}>{t('staff.signInTitle')}</Text>
        <Text style={styles.subtitle}>{t('staff.signInSubtitle')}</Text>

        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder={t('staff.username')}
          placeholderTextColor="rgba(246,243,236,0.5)"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('staff.username')}
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder={t('staff.password')}
          placeholderTextColor="rgba(246,243,236,0.5)"
          secureTextEntry
          accessibilityLabel={t('staff.password')}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.btn, busy && styles.btnDisabled]}
          onPress={onSignIn}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>{busy ? t('staff.signingIn') : t('staff.signIn')}</Text>
        </Pressable>
        <Pressable onPress={backToPicker} accessibilityRole="button">
          <Text style={styles.switch}>{t('staff.notStaff')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  mark: { fontSize: 40, textAlign: 'center' },
  title: { ...typeScale.display, color: '#F6F3EC', textAlign: 'center' },
  subtitle: { ...typeScale.body, color: '#CDD6CF', textAlign: 'center', marginBottom: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    ...typeScale.body,
    color: '#F6F3EC',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  error: { ...typeScale.caption, color: '#E7A79A' },
  btn: {
    backgroundColor: palette.marigold,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET + 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { ...typeScale.body, color: palette.ink, fontWeight: '800' },
  switch: { ...typeScale.caption, color: '#CDD6CF', textAlign: 'center', marginTop: spacing.md },
});
