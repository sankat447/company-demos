import { Redirect, Tabs } from 'expo-router';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { useAuth } from '@/auth/useAuth';
import { registerPushIfPossible } from '@/features/notifications/register';
import { color } from '@/ui/tokens';

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{glyph}</Text>;
}

export default function VisitorLayout() {
  const { t } = useTranslation();
  const auth = useAuth();

  // P3.4: register token + prefs once signed in; idempotent per payload.
  useEffect(() => {
    if (auth.status === 'signedIn') void registerPushIfPossible();
  }, [auth.status]);

  if (auth.status === 'signedOut') return <Redirect href="/(auth)/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.textMuted,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="🏔️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tickets"
        options={{
          title: t('tabs.tickets'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="🎫" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: t('tabs.schedule'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="🗓️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: t('tabs.assistant'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="💬" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
