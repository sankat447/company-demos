import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient as SvgGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { palette } from '@/ui/tokens';

/**
 * Launch moment (≤~1.7s): the "i" in Bir does one big jump up to the paraglider;
 * the instant its dot reaches it, two short hands leave the stem and grab the
 * white risers — then it glides toward the viewer as the marigold engulfs the
 * screen and the app comes to life. Rendered in one SVG (viewBox 300×600) so the
 * geometry matches the approved storyboard; the group transforms are driven by
 * RN Animated (reanimated isn't a dependency). onDone fires when the engulf ends.
 */
const { width: W, height: H } = Dimensions.get('window');

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedText = Animated.createAnimatedComponent(SvgText);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

export function LaunchSplash({ onDone }: { onDone: () => void }) {
  const intro = useRef(new Animated.Value(0)).current; // 0→1 fade-in
  const jump = useRef(new Animated.Value(0)).current; // 0→1 the big jump
  const hands = useRef(new Animated.Value(0)).current; // 0→1 hands leave the stem
  const fly = useRef(new Animated.Value(0)).current; // 0→1 glide toward viewer
  const veil = useRef(new Animated.Value(0)).current; // 0→1 marigold engulf
  const done = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (done.current) return;
      done.current = true;
      onDone();
    };
    Animated.sequence([
      Animated.timing(intro, { toValue: 1, duration: 240, useNativeDriver: false }),
      // one big jump up to the glider
      Animated.timing(jump, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      // the moment the dot meets it, the short hands sprout & grab
      Animated.timing(hands, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.back(1.7)),
        useNativeDriver: false,
      }),
      Animated.delay(70),
      // glide at the screen while the marigold engulfs
      Animated.parallel([
        Animated.timing(fly, {
          toValue: 1,
          duration: 600,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(veil, {
          toValue: 1,
          duration: 560,
          easing: Easing.in(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    ]).start(finish);
    const cap = setTimeout(finish, 2000);
    return () => clearTimeout(cap);
  }, [intro, jump, hands, fly, veil, onDone]);

  const jumpY = jump.interpolate({ inputRange: [0, 1], outputRange: [0, -110] });
  const flyScale = fly.interpolate({ inputRange: [0, 1], outputRange: [1, 18] });
  const flyY = fly.interpolate({ inputRange: [0, 1], outputRange: [0, -24] });
  const sideFade = fly.interpolate({
    inputRange: [0, 0.4],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const wordFade = Animated.multiply(intro, sideFade);

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#0e1a22', '#17232B', '#22403a']} style={StyleSheet.absoluteFill} />
      {/* frigid snow peaks + lush ridge (static) */}
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
        <Path
          d="M0 150 L0 92 L70 58 L140 96 L210 52 L280 88 L340 62 L340 150 Z"
          fill="url(#splashPeak)"
          opacity={0.96}
        />
        <Path d="M210 52 L197 80 L206 76 L210 90 L215 74 L226 80 Z" fill="#F5F9FB" />
        <Path d="M70 58 L58 84 L67 80 L70 92 L75 76 L86 82 Z" fill="#F5F9FB" />
        <Path d="M0 150 L0 116 L110 96 L230 122 L340 100 L340 150 Z" fill="#2E5E4E" />
        <Path d="M0 150 L0 132 L120 120 L260 138 L340 124 L340 150 Z" fill="#20473B" />
      </Svg>

      {/* the animated wordmark + glider + engulf */}
      <Svg
        style={StyleSheet.absoluteFill}
        width={W}
        height={H}
        viewBox="0 0 300 600"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* flywrap: the glide toward the viewer scales from the canopy */}
        <AnimatedG opacity={intro} translateY={flyY} scale={flyScale} originX={150} originY={208}>
          {/* paraglider (static) */}
          <G>
            <Path
              d="M110 205 C 130 183, 170 183, 190 205"
              fill="none"
              stroke={palette.marigold}
              strokeWidth={7}
              strokeLinecap="round"
            />
            <Path d="M118 205 L150 240 M182 205 L150 240" stroke="#F2F5EF" strokeWidth={2.4} />
          </G>
          {/* the "i" character — jumps up */}
          <AnimatedG translateY={jumpY}>
            {/* short hands leave the stem and reach the white risers */}
            <AnimatedG scale={hands} originX={145} originY={358}>
              <Path
                d="M145 358 C 141 350, 137 343, 135 336"
                fill="none"
                stroke={palette.marigold}
                strokeWidth={6}
                strokeLinecap="round"
              />
              <Circle cx={135} cy={335} r={4.6} fill={palette.marigold} />
            </AnimatedG>
            <AnimatedG scale={hands} originX={155} originY={358}>
              <Path
                d="M155 358 C 159 350, 163 343, 165 336"
                fill="none"
                stroke={palette.marigold}
                strokeWidth={6}
                strokeLinecap="round"
              />
              <Circle cx={165} cy={335} r={4.6} fill={palette.marigold} />
            </AnimatedG>
            {/* the wider "i" body + prominent dot */}
            <Rect x={143} y={352} width={14} height={42} rx={7} fill={palette.marigold} />
            <Circle cx={150} cy={328} r={8} fill={palette.marigold} />
          </AnimatedG>
        </AnimatedG>

        {/* B and r flank the i, then step aside */}
        <AnimatedText
          x={137}
          y={394}
          textAnchor="end"
          fontFamily="Fraunces_600SemiBold"
          fontSize={70}
          fill="#F2F5EF"
          opacity={wordFade}
        >
          B
        </AnimatedText>
        <AnimatedText
          x={163}
          y={394}
          textAnchor="start"
          fontFamily="Fraunces_600SemiBold"
          fontSize={70}
          fill="#F2F5EF"
          opacity={wordFade}
        >
          r
        </AnimatedText>
        <AnimatedText
          x={150}
          y={438}
          textAnchor="middle"
          fontFamily="Fraunces_600SemiBold"
          fontSize={24}
          fontStyle="italic"
          fill={palette.marigold}
          opacity={wordFade}
        >
          Feel the Bir
        </AnimatedText>

        {/* marigold engulf */}
        <AnimatedRect x={0} y={0} width={300} height={600} fill={palette.marigold} opacity={veil} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#17232B', overflow: 'hidden' },
  mtn: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
