import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { RoomForm } from '@/features/lodging/RoomForm';
import { kvRoomStore, newRoomId, type RoomError } from '@/features/lodging/rooms';
import { LODGING_NIGHTS, type Room } from '@/features/lodging/types';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { Screen } from '@/ui/Screen';

const store = kvRoomStore(kvStore, new SqliteOutboxStore());

const EMPTY: Room = {
  id: '',
  hotelName: '',
  roomLabel: '',
  type: 'twin',
  capacity: 2,
  doubleOccupancy: false,
  availability: { from: '2026-11-20', to: '2026-11-24', nights: [...LODGING_NIGHTS] },
  status: 'active',
};

export default function NewRoom() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<RoomError[]>([]);

  return (
    <Screen title={t('lodging.addRoom')}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <RoomForm
          initial={EMPTY}
          errors={errors}
          submitLabel={t('lodging.saveRoom')}
          onSubmit={async (room) => {
            const withId = { ...room, id: newRoomId(room.hotelName, room.roomLabel) };
            const found = await store.upsert(withId);
            setErrors(found);
            if (!found.length) {
              await queryClient.invalidateQueries({ queryKey: ['lodging', 'rooms'] });
              router.back();
            }
          }}
        />
      </ScrollView>
    </Screen>
  );
}
