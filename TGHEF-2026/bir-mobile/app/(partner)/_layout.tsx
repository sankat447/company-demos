import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { hasRole, useAuth } from '@/auth/useAuth';
import { color } from '@/ui/tokens';

/** Partner tabs render only when the Cognito `partner` group claim is present. */
export default function PartnerLayout() {
  const { t } = useTranslation();
  const auth = useAuth();

  if (auth.status === 'loading') return null;
  if (auth.status === 'signedOut') return <Redirect href="/(auth)/sign-in" />;
  if (!hasRole(auth, 'partner')) return <Redirect href="/(visitor)/home" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.textMuted,
      }}
    >
      <Tabs.Screen name="stalls" options={{ title: t('tabs.stalls') }} />
      <Tabs.Screen name="hospitality" options={{ title: t('tabs.hospitality') }} />
    </Tabs>
  );
}
