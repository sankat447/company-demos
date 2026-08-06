import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { RoomForm } from '@/features/lodging/RoomForm';
import { kvRoomStore, type RoomError } from '@/features/lodging/rooms';
import { kvStore } from '@/offline/db';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, radius, spacing, typeScale } from '@/ui/tokens';

const store = kvRoomStore(kvStore);

export default function EditRoom() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<RoomError[]>([]);
  const rooms = useQuery({
    queryKey: ['lodging', 'rooms'],
    queryFn: () => store.list(),
    networkMode: 'always',
  });
  const room = rooms.data?.find((r) => r.id === id);

  if (!room) {
    return (
      <Screen title={t('lodging.rooms')}>
        <Text style={styles.muted}>{t('lodging.noRooms')}</Text>
      </Screen>
    );
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['lodging', 'rooms'] });

  return (
    <Screen title={`${room.hotelName} · ${room.roomLabel}`}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {room.propertyId ? (
          <Text style={styles.partnerNote}>{t('lodging.partnerSourcedNote')}</Text>
        ) : null}
        <RoomForm
          initial={room}
          errors={errors}
          submitLabel={t('lodging.saveRoom')}
          onSubmit={async (next) => {
            const found = await store.upsert(next);
            setErrors(found);
            if (!found.length) {
              await refresh();
              router.back();
            }
          }}
        />
        <Pressable
          style={styles.retire}
          onPress={async () => {
            await store.setStatus(room.id, room.status === 'retired' ? 'active' : 'retired');
            await refresh();
            router.back();
          }}
          accessibilityRole="button"
          accessibilityLabel={
            room.status === 'retired' ? t('lodging.reactivate') : t('lodging.retire')
          }
        >
          <Text style={styles.retireText}>
            {room.status === 'retired' ? t('lodging.reactivate') : t('lodging.retire')}
          </Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { ...typeScale.body, color: color.textMuted, paddingVertical: spacing.md },
  partnerNote: {
    ...typeScale.caption,
    color: color.text,
    backgroundColor: '#FCF3E3',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  retire: {
    marginTop: spacing.md,
    marginBottom: spacing.xl,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  retireText: { ...typeScale.body, color: color.textMuted, fontWeight: '600' },
});
