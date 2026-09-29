import { router } from 'expo-router';
import React, { useCallback } from 'react';

import { markIntroSeen } from '@/onboarding/intro';
import { IntroFlow } from '@/ui/IntroFlow';

export default function IntroRoute() {
  const finish = useCallback(() => {
    void markIntroSeen();
    router.replace('/(visitor)/home');
  }, []);
  return <IntroFlow onDone={finish} />;
}
