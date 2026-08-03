import { Redirect } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { useAuth } from '@/auth/useAuth';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { color } from '@/ui/tokens';

export default function Index() {
  const auth = useAuth();

  if (auth.status === 'loading') {
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
  // Everyone lands on the visitor surface; partner/volunteer tabs appear per role.
  return <Redirect href="/(visitor)/home" />;
}
