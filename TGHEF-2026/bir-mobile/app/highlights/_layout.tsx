import { Stack } from 'expo-router';
import React from 'react';

import { color } from '@/ui/tokens';

export default function HighlightsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.bg },
      }}
    />
  );
}
