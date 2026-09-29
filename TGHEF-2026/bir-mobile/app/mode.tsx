import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';

import { setMode } from '@/mode/mode';
import { AlpineBackdrop } from '@/ui/AlpineBackdrop';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

/**
 * Launch mode picker (CO-004 live): the app splits into the Visitor experience
 * (phone/OTP) and Staff (admin username/password + scanner). The choice is
 * persisted; "switch mode" from either side clears it and returns here.
 */
export default function ModePicker() {
  const { t } = useTranslation();
  const router = useRouter();

  const choose = async (mode: 'visitor' | 'staff') => {
    await setMode(mode);
    router.replace(mode === 'staff' ? '/(staff)/sign-in' : '/');
  };

  return (
    <View style={styles.root}>
      <AlpineBackdrop height={Dimensions.get('window').height} />
      <View style={styles.content}>
        <Text style={styles.mark}>🪂</Text>
        <Text style={styles.title}>{t('mode.title')}</Text>
        <Text style={styles.subtitle}>{t('mode.subtitle')}</Text>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => choose('visitor')}
          accessibilityRole="button"
          accessibilityLabel={t('mode.visitor')}
        >
          <Text style={styles.cardIcon}>🎟️</Text>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>{t('mode.visitor')}</Text>
            <Text style={styles.cardDesc}>{t('mode.visitorDesc')}</Text>
          </View>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, styles.cardStaff, pressed && styles.cardPressed]}
          onPress={() => choose('staff')}
          accessibilityRole="button"
          accessibilityLabel={t('mode.staff')}
        >
          <Text style={styles.cardIcon}>🛂</Text>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>{t('mode.staff')}</Text>
            <Text style={styles.cardDesc}>{t('mode.staffDesc')}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  mark: { fontSize: 46, textAlign: 'center' },
  title: { ...typeScale.display, color: '#F6F3EC', textAlign: 'center' },
  subtitle: {
    ...typeScale.body,
    color: '#CDD6CF',
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.lg,
    padding: spacing.lg,
    minHeight: MIN_TOUCH_TARGET + 28,
  },
  cardStaff: { borderColor: 'rgba(232,161,61,0.4)' },
  cardPressed: { backgroundColor: 'rgba(255,255,255,0.14)' },
  cardIcon: { fontSize: 30 },
  cardText: { flex: 1 },
  cardTitle: { ...typeScale.title, color: '#F6F3EC' },
  cardDesc: { ...typeScale.caption, color: '#CDD6CF', marginTop: 2 },
});
