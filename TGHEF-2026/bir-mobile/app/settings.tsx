import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { registerPushIfPossible } from '@/features/notifications/register';
import {
  DEFAULT_QUIET_HOURS,
  loadQuietHours,
  saveQuietHours,
  type QuietHours,
} from '@/features/notifications/push';
import { kvStore } from '@/offline/db';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, radius, spacing, typeScale } from '@/ui/tokens';

function HourStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(next: number): void;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          style={styles.stepBtn}
          onPress={() => onChange((value + 23) % 24)}
          accessibilityRole="button"
          accessibilityLabel={`${label} −1`}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{String(value).padStart(2, '0')}:00</Text>
        <Pressable
          style={styles.stepBtn}
          onPress={() => onChange((value + 1) % 24)}
          accessibilityRole="button"
          accessibilityLabel={`${label} +1`}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * P3.4 — quiet-hours preference UI. Preferences persist locally and ride the
 * device-registration mutation; enforcement is server-side (Pinpoint journeys
 * respect quiet hours & the per-user budget).
 */
export default function Settings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const stored = useQuery({
    queryKey: ['quietHours'],
    queryFn: () => loadQuietHours(kvStore),
    networkMode: 'always',
  });
  const [draft, setDraft] = useState<QuietHours>(DEFAULT_QUIET_HOURS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (stored.data) setDraft(stored.data);
  }, [stored.data]);

  const save = async () => {
    await saveQuietHours(kvStore, draft);
    await queryClient.invalidateQueries({ queryKey: ['quietHours'] });
    // Prefs travel with the registration; a changed payload re-queues it.
    await registerPushIfPossible();
    setSaved(true);
  };

  return (
    <Screen title={t('settings.title')}>
      <Text style={styles.desc}>{t('settings.quietDesc')}</Text>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t('settings.enabled')}</Text>
        <Switch
          value={draft.enabled}
          onValueChange={(enabled) => {
            setDraft({ ...draft, enabled });
            setSaved(false);
          }}
          accessibilityLabel={t('settings.enabled')}
          trackColor={{ true: color.primary, false: color.cardBorder }}
        />
      </View>

      {draft.enabled ? (
        <>
          <HourStepper
            label={t('settings.from')}
            value={draft.startHour}
            onChange={(startHour) => {
              setDraft({ ...draft, startHour });
              setSaved(false);
            }}
          />
          <HourStepper
            label={t('settings.to')}
            value={draft.endHour}
            onChange={(endHour) => {
              setDraft({ ...draft, endHour });
              setSaved(false);
            }}
          />
        </>
      ) : null}

      {saved ? <Text style={styles.savedText}>{t('settings.saved')}</Text> : null}

      <Pressable
        style={styles.saveButton}
        onPress={save}
        accessibilityRole="button"
        accessibilityLabel={t('settings.save')}
      >
        <Text style={styles.saveText}>{t('settings.save')}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  desc: { ...typeScale.caption, color: color.textMuted, marginBottom: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    marginBottom: spacing.md,
  },
  rowLabel: { ...typeScale.body, color: color.text },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  stepperLabel: { ...typeScale.body, color: color.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  stepBtnText: { ...typeScale.heading, color: color.text },
  stepValue: { ...typeScale.heading, color: color.text, minWidth: 64, textAlign: 'center' },
  savedText: { ...typeScale.caption, color: color.success, marginBottom: spacing.sm },
  saveButton: {
    backgroundColor: color.primary,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  saveText: { ...typeScale.body, color: color.textInverse, fontWeight: '600' },
});
