import { useQuery } from '@tanstack/react-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { loadRoster } from '@/features/volunteers/roster';
import {
  fileIncident,
  INCIDENT_CATEGORIES,
  type IncidentCategory,
} from '@/features/volunteers/volunteer';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const outbox = new SqliteOutboxStore();

/**
 * P4.2 incident report: photo (optional) + category + note, queued through
 * the outbox so a report filed at a dead-signal gate still syncs on reconnect.
 */
export default function Incident() {
  const { t } = useTranslation();
  const [category, setCategory] = useState<IncidentCategory>('safety');
  const [note, setNote] = useState('');
  const [zone, setZone] = useState<string | undefined>();
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  // Offer the volunteer's own shift zones so an incident is tagged to a place
  // the ops desk can route on (reportIncident stores zone).
  const roster = useQuery({
    queryKey: ['volunteer', 'roster'],
    queryFn: loadRoster,
    networkMode: 'always',
  });
  const zones = [...new Set((roster.data?.shifts ?? []).map((s) => s.zone))];

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (!result.canceled) setPhotoUri(result.assets[0]?.uri);
  };

  const submit = async () => {
    const session = await fetchAuthSession().catch(() => null);
    const sub = String(session?.tokens?.idToken?.payload?.sub ?? 'demo-user');
    await fileIncident(outbox, { sub, category, note, photoUri, zone }, Date.now());
    setDone(true);
  };

  if (done) {
    return (
      <Screen title={t('volunteer.reportIncident')}>
        <Text style={styles.doneTitle}>{t('volunteer.incidentQueued')}</Text>
        <Text style={styles.doneBody}>{t('volunteer.incidentQueuedBody')}</Text>
        <Pressable
          style={styles.primary}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.confirm')}
        >
          <Text style={styles.primaryText}>{t('common.confirm')}</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen title={t('volunteer.reportIncident')}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.label}>{t('volunteer.category')}</Text>
        <View style={styles.chips}>
          {INCIDENT_CATEGORIES.map((cat) => (
            <Pressable
              key={cat}
              style={[styles.chip, category === cat && styles.chipOn]}
              onPress={() => setCategory(cat)}
              accessibilityRole="button"
              accessibilityLabel={t(`volunteer.cat_${cat}`)}
              accessibilityState={{ selected: category === cat }}
            >
              <Text style={[styles.chipText, category === cat && styles.chipTextOn]}>
                {t(`volunteer.cat_${cat}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        {zones.length ? (
          <>
            <Text style={styles.label}>{t('volunteer.zone')}</Text>
            <View style={styles.chips}>
              {zones.map((z) => (
                <Pressable
                  key={z}
                  style={[styles.chip, zone === z && styles.chipOn]}
                  onPress={() => setZone(zone === z ? undefined : z)}
                  accessibilityRole="button"
                  accessibilityLabel={z}
                  accessibilityState={{ selected: zone === z }}
                >
                  <Text style={[styles.chipText, zone === z && styles.chipTextOn]}>{z}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>{t('volunteer.note')}</Text>
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder={t('volunteer.noteHint')}
          placeholderTextColor={color.textMuted}
          accessibilityLabel={t('volunteer.note')}
        />

        <Pressable
          style={styles.photoBtn}
          onPress={pickPhoto}
          accessibilityRole="button"
          accessibilityLabel={t('volunteer.addPhoto')}
        >
          <Text style={styles.photoText}>
            {photoUri ? t('volunteer.photoAttached') : t('volunteer.addPhoto')}
          </Text>
        </Pressable>
        {photoUri ? <Image source={{ uri: photoUri }} style={styles.preview} /> : null}

        <Pressable
          style={[styles.primary, !note.trim() && styles.disabled]}
          disabled={!note.trim()}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel={t('volunteer.submitIncident')}
        >
          <Text style={styles.primaryText}>{t('volunteer.submitIncident')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  label: {
    ...typeScale.caption,
    color: color.text,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: 6,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.cardBorder,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { borderColor: palette.pine, backgroundColor: '#E4EEE8' },
  chipText: { ...typeScale.body, color: color.text },
  chipTextOn: { color: palette.pine, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 90,
    ...typeScale.body,
    color: color.text,
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
  },
  photoBtn: {
    marginTop: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.info,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoText: { ...typeScale.body, color: color.info, fontWeight: '600' },
  preview: { width: '100%', height: 160, borderRadius: radius.md, marginTop: spacing.sm },
  primary: {
    marginTop: spacing.lg,
    backgroundColor: palette.pine,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  primaryText: { ...typeScale.body, color: color.textInverse, fontWeight: '700' },
  doneTitle: { ...typeScale.title, color: palette.pine, marginTop: spacing.lg },
  doneBody: { ...typeScale.body, color: color.textMuted, marginTop: spacing.sm, lineHeight: 21 },
});
