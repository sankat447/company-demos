import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/auth/useAuth';
import { getMode, type AppMode } from '@/mode/mode';
import { hasSeenIntro } from '@/onboarding/intro';
import { LaunchSplash } from '@/ui/LaunchSplash';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { color } from '@/ui/tokens';

function centered(node: React.ReactNode) {
  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg }}
    >
      {node}
    </View>
  );
}

export default function Index() {
  const auth = useAuth();
  const [splashDone, setSplashDone] = useState(false);
  const [introSeen, setIntroSeen] = useState<boolean | undefined>(undefined);
  // undefined = still reading; null = no choice yet → show the picker.
  const [mode, setModeState] = useState<AppMode | null | undefined>(undefined);

  useEffect(() => {
    void hasSeenIntro().then(setIntroSeen);
    void getMode().then((m) => setModeState(m));
  }, []);

  // Launch moment first (the glider sways → flies → engulfs), then route.
  if (!splashDone) return <LaunchSplash onDone={() => setSplashDone(true)} />;

  if (mode === undefined) return centered(<ParagliderSpinner />);
  // First launch (or after "switch mode"): choose Visitor vs Staff.
  if (mode === null) return <Redirect href="/mode" />;
  // Staff mode is a separate stack with its own username/password auth.
  if (mode === 'staff') return <Redirect href="/(staff)/home" />;

  // Visitor mode: Cognito phone/OTP.
  if (auth.status === 'loading' || (auth.status === 'signedIn' && introSeen === undefined)) {
    return centered(<ParagliderSpinner />);
  }
  if (auth.status === 'signedOut') return <Redirect href="/(auth)/sign-in" />;
  if (introSeen === false) return <Redirect href="/intro" />;
  return <Redirect href="/(visitor)/home" />;
}
