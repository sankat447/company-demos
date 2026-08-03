import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { palette } from './tokens';

/** Loading indicator: the paraglider mark gently swaying on its lines. */
export function ParagliderSpinner({ size = 48 }: { size?: number }) {
  const sway = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(sway, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sway]);

  const rotate = sway.interpolate({ inputRange: [0, 1], outputRange: ['-12deg', '12deg'] });

  return (
    <Animated.View
      style={{ width: size, height: size, transform: [{ rotate }] }}
      accessibilityRole="progressbar"
    >
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Path
          d="M4 14 C 16 4, 32 4, 44 14 C 34 12, 14 12, 4 14 Z"
          fill={palette.marigold}
          stroke={palette.ink}
          strokeWidth={1.2}
        />
        <Path d="M8 14 L 23 32 M40 14 L 25 32" stroke={palette.ink} strokeWidth={1.2} />
        <Path d="M22 32 a 3 4 0 1 0 6 0 a 3 4 0 1 0 -6 0" fill={palette.slate} />
      </Svg>
    </Animated.View>
  );
}
