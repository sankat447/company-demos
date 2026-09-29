import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Dimensions, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { AlpineBackdrop } from '@/ui/AlpineBackdrop';
import { palette, radius, spacing, typeScale } from '@/ui/tokens';

/**
 * First-run festival introduction. A short sequence of panels over the alpine
 * scene; moving between them replays the brand's dotted flight-line — the
 * paraglider glides across the screen while the next panel emerges behind it.
 * onDone fires when the visitor finishes (or skips).
 */
const { width: W } = Dimensions.get('window');

type Panel = { icon: string; titleKey: string; bodyKey: string };
const PANELS: Panel[] = [
  { icon: '🪂', titleKey: 'intro.p1Title', bodyKey: 'intro.p1Body' },
  { icon: '🎟️', titleKey: 'intro.p2Title', bodyKey: 'intro.p2Body' },
  { icon: '📶', titleKey: 'intro.p3Title', bodyKey: 'intro.p3Body' },
];

function Glider({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="-20 -14 40 32">
      <G rotation={9}>
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

export function IntroFlow({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const busy = useRef(false);

  // Transition drivers. `glide` sweeps the paraglider across the flight line;
  // `content` crossfades the outgoing panel out and the incoming one in.
  const glide = useRef(new Animated.Value(0)).current; // 0 → 1 across the screen
  const content = useRef(new Animated.Value(1)).current; // 1 = settled panel visible

  const advance = useCallback(
    (next: number) => {
      if (busy.current) return;
      const last = next >= PANELS.length;
      busy.current = true;
      glide.setValue(0);
      Animated.parallel([
        Animated.timing(glide, {
          toValue: 1,
          duration: 620,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          // fade the current panel out just ahead of the glider…
          Animated.timing(content, {
            toValue: 0,
            duration: 240,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          // …swap content at the midpoint, then let it emerge behind the glider
          Animated.timing(content, {
            toValue: 1,
            duration: 300,
            delay: 80,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => {
        busy.current = false;
        if (last) onDone();
      });
      // swap at the fade's midpoint so the new copy rides in behind the glider
      if (!last) setTimeout(() => setIndex(next), 260);
    },
    [glide, content, onDone],
  );

  const panel = PANELS[index];

  // glider path: off the left edge → off the right, dipping then lifting (a
  // shallow descending-then-rising arc, echoing the Billing→Bir flight line).
  const gliderX = glide.interpolate({ inputRange: [0, 1], outputRange: [-70, W + 70] });
  const gliderY = glide.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [-18, 26, -30],
  });
  const gliderFade = glide.interpolate({
    inputRange: [0, 0.12, 0.88, 1],
    outputRange: [0, 1, 1, 0],
  });
  const contentSlide = content.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <View style={styles.root}>
      <AlpineBackdrop height={Dimensions.get('window').height} />

      {/* skip */}
      <Pressable
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel={t('intro.skip')}
        style={[styles.skip, { top: insets.top + 8 }]}
        hitSlop={10}
      >
        <Text style={styles.skipText}>{t('intro.skip')}</Text>
      </Pressable>

      {/* the gliding paraglider (rides above content during a transition) */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glider,
          {
            top: '38%',
            transform: [{ translateX: gliderX }, { translateY: gliderY }],
            opacity: gliderFade,
          },
        ]}
      >
        <Glider size={64} />
      </Animated.View>

      {/* panel content */}
      <View style={[styles.body, { paddingBottom: insets.bottom + 28 }]}>
        <Animated.View
          style={{
            opacity: content,
            transform: [{ translateY: contentSlide }],
            alignItems: 'center',
          }}
        >
          <Text style={styles.emoji}>{panel.icon}</Text>
          <Text style={styles.title}>{t(panel.titleKey)}</Text>
          <Text style={styles.text}>{t(panel.bodyKey)}</Text>
        </Animated.View>

        {/* progress dots */}
        <View style={styles.dots}>
          {PANELS.map((p, i) => (
            <View key={p.titleKey} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>

        <Pressable
          onPress={() => advance(index + 1)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <Text style={styles.ctaText}>
            {index === PANELS.length - 1 ? t('intro.start') : t('intro.next')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink },
  skip: { position: 'absolute', right: 16, zIndex: 5, paddingVertical: 6, paddingHorizontal: 10 },
  skipText: { color: '#CBD8D2', fontSize: 13, fontWeight: '600' },
  glider: { position: 'absolute', left: 0, zIndex: 4 },
  body: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 28, gap: 22 },
  emoji: { fontSize: 44, marginBottom: 14 },
  title: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 30,
    color: '#F2F5EF',
    textAlign: 'center',
    marginBottom: 12,
  },
  text: {
    ...typeScale.body,
    color: '#D6E2DC',
    textAlign: 'center',
    lineHeight: 23,
    maxWidth: 320,
  },
  dots: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  dotOn: { backgroundColor: palette.marigold, width: 20 },
  cta: {
    backgroundColor: palette.marigold,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: { color: palette.ink, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
});
