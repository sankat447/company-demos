import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

import { palette } from '@/ui/tokens';

/**
 * Launch moment (≤~1.7s): the "i" in Bir does one big jump up to the paraglider;
 * the instant its dot reaches it, two short hands leave the stem and grab the
 * white risers — then it glides toward the viewer as the marigold engulfs the
 * screen and the app comes to life. Every animated piece is a plain View driven
 * on the NATIVE driver (reanimated isn't a dependency), so it plays smoothly
 * even while the JS thread is busy booting the app. onDone fires at the engulf.
 */
const { width: W, height: H } = Dimensions.get('window');
const M = palette.marigold;
const PAPER = '#F2F5EF';
const GLIDER_GAP = 66; // space between the wordmark and the glider = the jump target

function GliderCanopy() {
  return (
    <Svg width={128} height={62} viewBox="0 0 128 62">
      <Path
        d="M12 40 C 43 10, 85 10, 116 40"
        fill="none"
        stroke={M}
        strokeWidth={7}
        strokeLinecap="round"
      />
      <Path d="M25 40 L64 60 M103 40 L64 60" stroke={PAPER} strokeWidth={2.4} />
    </Svg>
  );
}

/** The wider "i" body + its prominent dot. */
function IStem() {
  return (
    <Svg width={20} height={64} viewBox="0 0 20 64">
      <Rect x={3} y={20} width={14} height={42} rx={7} fill={M} />
      <Circle cx={10} cy={8} r={8} fill={M} />
    </Svg>
  );
}

/** A short hand reaching up-and-out; `flip` mirrors it for the left side. */
function HandShape({ flip }: { flip?: boolean }) {
  return (
    <Svg width={24} height={30} viewBox="0 0 24 30" style={flip ? styles.flip : undefined}>
      <Path
        d="M5 29 C 9 21, 15 12, 19 5"
        fill="none"
        stroke={M}
        strokeWidth={6}
        strokeLinecap="round"
      />
      <Circle cx={20} cy={4} r={4.6} fill={M} />
    </Svg>
  );
}

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
      Animated.timing(intro, { toValue: 1, duration: 240, useNativeDriver: true }),
      Animated.timing(jump, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(hands, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.back(1.7)),
        useNativeDriver: true,
      }),
      Animated.delay(60),
      Animated.parallel([
        Animated.timing(fly, {
          toValue: 1,
          duration: 580,
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
    const cap = setTimeout(finish, 2000);
    return () => clearTimeout(cap);
  }, [intro, jump, hands, fly, veil, onDone]);

  const jumpY = jump.interpolate({ inputRange: [0, 1], outputRange: [0, -(GLIDER_GAP + 30)] });
  const flyScale = fly.interpolate({ inputRange: [0, 1], outputRange: [1, 16] });
  const flyY = fly.interpolate({ inputRange: [0, 1], outputRange: [0, -28] });
  const sideFade = fly.interpolate({
    inputRange: [0, 0.4],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const wordFade = Animated.multiply(intro, sideFade);
  const iTY = Animated.add(jumpY, flyY);

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

      <View style={styles.center}>
        {/* paraglider */}
        <Animated.View
          style={{ opacity: intro, transform: [{ translateY: flyY }, { scale: flyScale }] }}
        >
          <GliderCanopy />
        </Animated.View>

        <View style={{ height: GLIDER_GAP }} />

        {/* wordmark: B [i] r */}
        <View style={styles.wordRow}>
          <Animated.Text style={[styles.word, { opacity: wordFade }]}>B</Animated.Text>
          <Animated.View
            style={{ opacity: intro, transform: [{ translateY: iTY }, { scale: flyScale }] }}
          >
            <View style={styles.iBox}>
              <IStem />
              <Animated.View
                style={[styles.handL, { opacity: hands, transform: [{ scale: hands }] }]}
              >
                <HandShape flip />
              </Animated.View>
              <Animated.View
                style={[styles.handR, { opacity: hands, transform: [{ scale: hands }] }]}
              >
                <HandShape />
              </Animated.View>
            </View>
          </Animated.View>
          <Animated.Text style={[styles.word, { opacity: wordFade }]}>r</Animated.Text>
        </View>

        <Animated.Text style={[styles.slogan, { opacity: wordFade }]}>Feel the Bir</Animated.Text>
      </View>

      {/* marigold engulf */}
      <Animated.View pointerEvents="none" style={[styles.veil, { opacity: veil }]} />
    </View>
  );
}

const CAP = 58;
const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#17232B', overflow: 'hidden' },
  mtn: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: H * 0.05 },
  flip: { transform: [{ scaleX: -1 }] },
  wordRow: { flexDirection: 'row', alignItems: 'flex-end' },
  word: { fontFamily: 'Fraunces_600SemiBold', fontSize: CAP, lineHeight: CAP * 1.12, color: PAPER },
  // the "i" occupies the slot between B and r; hands overflow up-and-out.
  iBox: { width: 20, height: CAP * 1.12, alignItems: 'center', justifyContent: 'flex-end' },
  handL: { position: 'absolute', top: 2, left: -16, transformOrigin: 'right bottom' },
  handR: { position: 'absolute', top: 2, right: -16, transformOrigin: 'left bottom' },
  slogan: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 20,
    color: M,
    fontStyle: 'italic',
    marginTop: 14,
  },
  veil: { ...StyleSheet.absoluteFillObject, backgroundColor: M },
});
