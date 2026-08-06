import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

import type { RoomError } from './rooms';
import { LODGING_NIGHTS, type Room, type RoomType } from './types';

const TYPES: RoomType[] = ['twin', 'double', 'triple', 'dorm'];

/** Shared add/edit room form (P6.10) with inline EN+HI validation. */
export function RoomForm({
  initial,
  errors,
  onSubmit,
  submitLabel,
}: {
  initial: Room;
  errors: RoomError[];
  onSubmit(room: Room): void;
  submitLabel: string;
}) {
  const { t } = useTranslation();
  const [room, setRoom] = useState<Room>(initial);
  const hasError = (field: string) => errors.some((e) => e.field === field);
  const errorText = (field: RoomError['field']): string | null => {
    const found = errors.find((e) => e.field === field);
    return found ? t(`lodging.err.${found.error}`) : null;
  };

  const toggleNight = (night: string) => {
    const nights = room.availability.nights.includes(night)
      ? room.availability.nights.filter((n) => n !== night)
      : [...room.availability.nights, night].sort();
    setRoom({ ...room, availability: { ...room.availability, nights } });
  };

  return (
    <View>
      <Text style={styles.label}>{t('lodging.hotelName')}</Text>
      <TextInput
        style={[styles.input, hasError('hotelName') && styles.inputError]}
        value={room.hotelName}
        onChangeText={(hotelName) => setRoom({ ...room, hotelName })}
        accessibilityLabel={t('lodging.hotelName')}
      />
      <Text style={styles.label}>{t('lodging.roomLabel')}</Text>
      <TextInput
        style={[styles.input, hasError('roomLabel') && styles.inputError]}
        value={room.roomLabel}
        onChangeText={(roomLabel) => setRoom({ ...room, roomLabel })}
        accessibilityLabel={t('lodging.roomLabel')}
      />
      {errorText('roomLabel') ? <Text style={styles.err}>{errorText('roomLabel')}</Text> : null}

      <Text style={styles.label}>{t('lodging.type')}</Text>
      <View style={styles.chips}>
        {TYPES.map((type) => (
          <Pressable
            key={type}
            style={[styles.chip, room.type === type && styles.chipOn]}
            onPress={() =>
              setRoom({
                ...room,
                type,
                doubleOccupancy: type === 'double',
                capacity: type === 'double' ? 2 : room.capacity,
              })
            }
            accessibilityRole="button"
            accessibilityLabel={t(`lodging.type_${type}`)}
            accessibilityState={{ selected: room.type === type }}
          >
            <Text style={[styles.chipText, room.type === type && styles.chipTextOn]}>
              {t(`lodging.type_${type}`)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>{t('lodging.capacity')}</Text>
      <View style={styles.stepper}>
        <Pressable
          style={styles.stepBtn}
          onPress={() => setRoom({ ...room, capacity: Math.max(1, room.capacity - 1) })}
          accessibilityRole="button"
          accessibilityLabel={`${t('lodging.capacity')} −1`}
        >
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{room.capacity}</Text>
        <Pressable
          style={styles.stepBtn}
          onPress={() => setRoom({ ...room, capacity: room.capacity + 1 })}
          accessibilityRole="button"
          accessibilityLabel={`${t('lodging.capacity')} +1`}
        >
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
      {errorText('capacity') ? <Text style={styles.err}>{errorText('capacity')}</Text> : null}
      {errorText('doubleOccupancy') ? (
        <Text style={styles.err}>{errorText('doubleOccupancy')}</Text>
      ) : null}

      <View style={styles.switchRow}>
        <Switch
          value={room.doubleOccupancy}
          onValueChange={(doubleOccupancy) => setRoom({ ...room, doubleOccupancy })}
          accessibilityLabel={t('lodging.doubleOccupancy')}
          trackColor={{ true: color.primary, false: color.cardBorder }}
        />
        <Text style={styles.switchLabel}>{t('lodging.doubleOccupancy')}</Text>
      </View>

      <Text style={styles.label}>{t('lodging.nights')}</Text>
      <View style={styles.chips}>
        {LODGING_NIGHTS.map((night) => (
          <Pressable
            key={night}
            style={[styles.chip, room.availability.nights.includes(night) && styles.chipOn]}
            onPress={() => toggleNight(night)}
            accessibilityRole="button"
            accessibilityLabel={night}
            accessibilityState={{ selected: room.availability.nights.includes(night) }}
          >
            <Text
              style={[
                styles.chipText,
                room.availability.nights.includes(night) && styles.chipTextOn,
              ]}
            >
              {night.slice(8)} Nov
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>{t('lodging.contactPhone')}</Text>
      <TextInput
        style={styles.input}
        value={room.contactPhone ?? ''}
        onChangeText={(contactPhone) => setRoom({ ...room, contactPhone })}
        keyboardType="phone-pad"
        accessibilityLabel={t('lodging.contactPhone')}
      />

      <Pressable
        style={styles.submit}
        onPress={() => onSubmit(room)}
        accessibilityRole="button"
        accessibilityLabel={submitLabel}
      >
        <Text style={styles.submitText}>{submitLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typeScale.caption,
    color: color.text,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: 6,
  },
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
  err: { ...typeScale.caption, color: color.danger, marginTop: 4 },
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
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  stepText: { ...typeScale.heading, color: color.text },
  stepValue: { ...typeScale.heading, color: color.text, minWidth: 32, textAlign: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  switchLabel: { ...typeScale.caption, color: color.text, flex: 1 },
  submit: {
    marginTop: spacing.lg,
    backgroundColor: palette.ink,
    borderColor: palette.marigold,
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET + 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { ...typeScale.body, color: palette.marigold, fontWeight: '700' },
});
