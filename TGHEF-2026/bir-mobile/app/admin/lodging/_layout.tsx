import { Redirect, Stack } from 'expo-router';
import React from 'react';

import { hasRole, useAuth } from '@/auth/useAuth';
import { color } from '@/ui/tokens';

/**
 * CO-003: renders only for the admin-hospitality group (Hospitality &
 * Accommodation dashboard family). Client gate is UX — every mutation is
 * ALSO group-guarded and audit-logged server-side (ASK #27).
 */
export default function AdminLodgingLayout() {
  const auth = useAuth();

  if (auth.status === 'loading') return null;
  if (auth.status === 'signedOut') return <Redirect href="/(auth)/sign-in" />;
  if (!hasRole(auth, 'admin-hospitality')) return <Redirect href="/(visitor)/home" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.bg },
      }}
    />
  );
}
