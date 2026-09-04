import { Stack } from 'expo-router';
import React from 'react';

import { color } from '@/ui/tokens';

/** Staff mode stack (admin username/password auth; scanner + dashboards). */
export default function StaffLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />
  );
}
