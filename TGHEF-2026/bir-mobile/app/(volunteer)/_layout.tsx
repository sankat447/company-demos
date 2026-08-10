import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { hasRole, useAuth } from '@/auth/useAuth';
import { color } from '@/ui/tokens';

/** Volunteer tabs render only for `volunteer` / `organiser-lite` groups. */
export default function VolunteerLayout() {
  const { t } = useTranslation();
  const auth = useAuth();

  if (auth.status === 'loading') return null;
  if (auth.status === 'signedOut') return <Redirect href="/(auth)/sign-in" />;
  if (!hasRole(auth, 'volunteer') && !hasRole(auth, 'organiser-lite')) {
    return <Redirect href="/(visitor)/home" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.textMuted,
      }}
    >
      <Tabs.Screen name="roster" options={{ title: t('tabs.roster') }} />
      <Tabs.Screen name="scanner" options={{ title: t('tabs.scanner') }} />
      {/* pushed from roster, not a tab */}
      <Tabs.Screen name="incident" options={{ href: null }} />
    </Tabs>
  );
}
