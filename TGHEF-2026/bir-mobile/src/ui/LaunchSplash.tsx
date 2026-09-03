import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, G, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

import { palette, typeScale } from '@/ui/tokens';

/**
 * Launch moment (≤1.5s): the paraglider sways, then flies forward and its
 * marigold engulfs the screen — and the app comes to life. Built on RN
 * Animated (reanimated isn't a dependency); transforms/opacity run on the
 * native driver. onDone fires when the engulf completes.
 */
const { width: W, height: H } = Dimensions.get('window');

function GliderMark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="-20 -14 40 32">
      <G rotation={10}>
        <Path
          d="M-17 0 C -9 -9, 9 -9, 17 0"
          fill="none"
          stroke={palette.marigold}
          strokeWidth={3.6}
          strokeLinecap="round"
        />
        <Path d="M-14 -1 L0 10 M14 -1 L0 10" stroke={palette.paper} strokeWidth={1.1} />
        <Circle cx={0} cy={11.5} r={2.6} fill="#7FE0A6" />
      </G>
    </Svg>
  );
}

export function LaunchSplash({ onDone }: { onDone: () => void }) {
  const intro = useRef(new Animated.Value(0)).current; // 0→1 fade-in
  const sway = useRef(new Animated.Value(0)).current; // -1..1 rotate
  const fly = useRef(new Animated.Value(0)).current; // 0→1 forward flight
  const veil = useRef(new Animated.Value(0)).current; // 0→1 marigold engulf
  const done = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (done.current) return;
      done.current = true;
      onDone();
    };
    Animated.sequence([
      Animated.timing(intro, { toValue: 1, duration: 220, useNativeDriver: true }),
      // sway: right, left, settle
      Animated.timing(sway, {
        toValue: 1,
        duration: 170,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
      Animated.timing(sway, {
        toValue: -1,
        duration: 200,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
      Animated.timing(sway, { toValue: 0, duration: 110, useNativeDriver: true }),
      // fly forward + engulf
      Animated.parallel([
        Animated.timing(fly, {
          toValue: 1,
          duration: 560,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(veil, {
          toValue: 1,
          duration: 560,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]).start(finish);
    // hard cap so navigation never blocks on the animation
    const cap = setTimeout(finish, 1500);
    return () => clearTimeout(cap);
  }, [intro, sway, fly, veil, onDone]);

  const rotate = sway.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] });
  const scale = fly.interpolate({ inputRange: [0, 1], outputRange: [1, 16] });
  const translateY = fly.interpolate({ inputRange: [0, 1], outputRange: [0, -28] });
  const gliderFade = fly.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
  const textFade = fly.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0] });

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#0e1a22', '#17232B', '#22403a']} style={StyleSheet.absoluteFill} />
      {/* frigid snow peaks + lush ridge + flight line */}
      <Svg
        style={styles.mtn}
        width={W}
        height={180}
        viewBox="0 0 340 150"
        preserveAspectRatio="none"
      >
        <Defs>
          <SvgGradient id="splashPeak" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#EAF1F5" />
            <Stop offset="0.45" stopColor="#B9CCD8" />
            <Stop offset="1" stopColor="#3E6B8C" />
          </SvgGradient>
        </Defs>
        {/* flight line above the peaks */}
        <Path
          d="M20 44 C 90 30, 200 56, 300 18"
          stroke={palette.marigold}
          strokeWidth={1.6}
          strokeDasharray="5 5"
          fill="none"
          opacity={0.8}
        />
        {/* frigid snow-capped peaks */}
        <Path
          d="M0 150 L0 92 L70 58 L140 96 L210 52 L280 88 L340 62 L340 150 Z"
          fill="url(#splashPeak)"
          opacity={0.96}
        />
        <Path d="M210 52 L197 80 L206 76 L210 90 L215 74 L226 80 Z" fill="#F5F9FB" />
        <Path d="M70 58 L58 84 L67 80 L70 92 L75 76 L86 82 Z" fill="#F5F9FB" />
        {/* lush pine ridge anchored to the bottom */}
        <Path d="M0 150 L0 116 L110 96 L230 122 L340 100 L340 150 Z" fill="#2E5E4E" />
        <Path d="M0 150 L0 132 L120 120 L260 138 L340 124 L340 150 Z" fill="#20473B" />
      </Svg>

      <Animated.View style={[styles.center, { opacity: intro }]}>
        <Animated.View
          style={{ transform: [{ translateY }, { scale }, { rotate }], opacity: gliderFade }}
        >
          <GliderMark size={92} />
        </Animated.View>
        <Animated.View style={{ opacity: textFade, alignItems: 'center' }}>
          <Text style={styles.word}>Bir</Text>
          <Text style={styles.slogan}>Feel the Bir</Text>
          <Text style={styles.sub}>FESTIVAL 2026 · 21–23 NOV</Text>
        </Animated.View>
      </Animated.View>

      {/* marigold engulf */}
      <Animated.View pointerEvents="none" style={[styles.veil, { opacity: veil }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#17232B', overflow: 'hidden' },
  mtn: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingBottom: H * 0.06,
  },
  word: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 56,
    color: '#F2F5EF',
    letterSpacing: 0.5,
    marginTop: 14,
  },
  slogan: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 20,
    color: palette.marigold,
    fontStyle: 'italic',
  },
  sub: { ...typeScale.caption, color: '#9FB2AC', letterSpacing: 3, marginTop: 6, fontSize: 10 },
  veil: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.marigold },
});
