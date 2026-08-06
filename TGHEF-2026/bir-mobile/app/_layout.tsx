import { Fraunces_600SemiBold, useFonts } from '@expo-google-fonts/fraunces';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';

import { configureAmplify } from '@/config/amplify';
import '@/i18n';
import { startOutboxAutoDrain } from '@/offline/drain';
import { color } from '@/ui/tokens';

configureAmplify();
void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Offline-first: serve cache immediately, retry with backoff handled per-query.
      staleTime: 60_000,
      gcTime: 24 * 60 * 60 * 1000,
    },
  },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Fraunces_600SemiBold });

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // Queued mutations (votes, scans) ship whenever connectivity returns.
  useEffect(() => {
    startOutboxAutoDrain();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.bg },
        }}
      />
    </QueryClientProvider>
  );
}
