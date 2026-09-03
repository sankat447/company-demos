import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/auth/useAuth';
import { hasSeenIntro } from '@/onboarding/intro';
import { LaunchSplash } from '@/ui/LaunchSplash';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { color } from '@/ui/tokens';

export default function Index() {
  const auth = useAuth();
  const [splashDone, setSplashDone] = useState(false);
  // undefined = still checking local storage; then true/false.
  const [introSeen, setIntroSeen] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void hasSeenIntro().then(setIntroSeen);
  }, []);

  // Launch moment first (the glider sways → flies → engulfs), then route.
  if (!splashDone) return <LaunchSplash onDone={() => setSplashDone(true)} />;

  if (auth.status === 'loading' || (auth.status === 'signedIn' && introSeen === undefined)) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color.bg,
        }}
      >
        <ParagliderSpinner />
      </View>
    );
  }
  if (auth.status === 'signedOut') return <Redirect href="/(auth)/sign-in" />;
  // First run after sign-in: a friendly festival introduction, once.
  if (introSeen === false) return <Redirect href="/intro" />;
  // Everyone lands on the visitor surface; partner/volunteer tabs appear per role.
  return <Redirect href="/(visitor)/home" />;
}
