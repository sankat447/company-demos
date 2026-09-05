import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { ageBandFromDob, loadProfile, saveProfile } from '@/features/profile/profile';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Profile & consent (Phase 1). Captures the DPDP-consented name + DOB the
 * master ticket needs. Only the derived age-band ever leaves the device in the
 * QR — the DOB itself stays server-side.
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const existing = useQuery({ queryKey: ['profile'], queryFn: loadProfile, networkMode: 'always' });

  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing.data) {
      setName(existing.data.displayName || '');
      setDob(existing.data.dob || '');
      setConsent(!!existing.data.consentDpdp);
    }
  }, [existing.data]);

  const band = DOB_RE.test(dob) ? ageBandFromDob(dob) : '';

  const onSave = async () => {
    setError(null);
    if (!name.trim()) return setError(t('profile.needName'));
    if (!DOB_RE.test(dob) || !band) return setError(t('profile.invalidDob'));
    if (!consent) return setError(t('profile.needConsent'));
    setSaving(true);
    try {
      await saveProfile({ displayName: name.trim(), dob, consentDpdp: true });
      router.replace('/ticket');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen title={t('profile.title')}>
      <View style={styles.stack}>
        <Text style={styles.lede}>{t('profile.lede')}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>{t('profile.name')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('profile.namePlaceholder')}
            placeholderTextColor={color.textMuted}
            accessibilityLabel={t('profile.name')}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('profile.dob')}</Text>
          <TextInput
            style={styles.input}
            value={dob}
            onChangeText={setDob}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={color.textMuted}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            accessibilityLabel={t('profile.dob')}
          />
          <Text style={styles.hint}>
            {band ? t('profile.ageBand', { band: t(`ageBand.${band}`) }) : t('profile.dobHint')}
          </Text>
        </View>

        <View style={styles.consentRow}>
          <Switch
            value={consent}
            onValueChange={setConsent}
            trackColor={{ true: palette.pine, false: color.cardBorder }}
            accessibilityLabel={t('profile.consent')}
          />
          <Text style={styles.consentText}>{t('profile.consentText')}</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.btn, saving && styles.btnDisabled]}
          onPress={onSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={t('profile.save')}
        >
          <Text style={styles.btnText}>{saving ? t('profile.saving') : t('profile.save')}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, paddingBottom: spacing.xl },
  lede: { ...typeScale.body, color: color.textMuted },
  field: { gap: spacing.xs },
  label: { ...typeScale.caption, color: color.textMuted, fontWeight: '600' },
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
  hint: { ...typeScale.caption, color: palette.pine },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  consentText: { ...typeScale.caption, color: color.text, flex: 1 },
  error: { ...typeScale.caption, color: palette.flagRed },
  btn: {
    backgroundColor: palette.marigold,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET + 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { ...typeScale.body, color: palette.ink, fontWeight: '800' },
});
