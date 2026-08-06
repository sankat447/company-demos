import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

/**
 * The hero alpine scene from the home-page design: prayer flags, three
 * ridges, the Billing→Bir flight line, altitude labels, and a paraglider
 * animated along the line (SMIL isn't available in react-native-svg, so the
 * glider rides an Animated bezier interpolation instead).
 */

// Flight line: M40 34 C 150 52, 280 86, 396 122 (viewBox 414×150)
const P0 = { x: 40, y: 34 };
const P1 = { x: 150, y: 52 };
const P2 = { x: 280, y: 86 };
const P3 = { x: 396, y: 122 };
const VIEW_W = 414;
const VIEW_H = 150;
const STEPS = 24;

function bezier(t: number): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * u * P0.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x,
    y: u * u * u * P0.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * P3.y,
  };
}

function Glider({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="-18 -12 36 28">
      <G rotation={12}>
        <Path
          d="M-16 0 C -8 -8, 8 -8, 16 0"
          fill="none"
          stroke="#E8A13D"
          strokeWidth={3.4}
          strokeLinecap="round"
        />
        <Path d="M-13 -1 L0 9 M13 -1 L0 9" stroke="#F7F8F5" strokeWidth={1} />
        <Circle cx={0} cy={10.5} r={2.4} fill="#F7F8F5" />
      </G>
    </Svg>
  );
}

export function AlpineScene() {
  const [width, setWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 16_000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const scale = width / VIEW_W;
  const gliderSize = 36 * scale;

  const { translateX, translateY } = useMemo(() => {
    const input: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const p = bezier(t);
      input.push(t);
      xs.push(p.x * scale - gliderSize / 2);
      ys.push(p.y * scale - gliderSize / 2);
    }
    return {
      translateX: progress.interpolate({ inputRange: input, outputRange: xs }),
      translateY: progress.interpolate({ inputRange: input, outputRange: ys }),
    };
  }, [progress, scale, gliderSize]);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <>
          <Svg width={width} height={VIEW_H * scale} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
            <Defs>
              <LinearGradient id="sn" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#DFEAF1" />
                <Stop offset="1" stopColor="#9DB3C0" />
              </LinearGradient>
            </Defs>
            {/* prayer flags */}
            <G x={18} y={4}>
              <Path d="M0 8 Q60 26 120 10" fill="none" stroke="#8FA3AD" strokeWidth={1.3} />
              <Rect
                x={6}
                y={6}
                width={13}
                height={10}
                rx={1.5}
                fill="#3E6B8C"
                rotation={5}
                originX={12}
                originY={11}
              />
              <Rect
                x={28}
                y={11}
                width={13}
                height={10}
                rx={1.5}
                fill="#F7F8F5"
                rotation={3}
                originX={34}
                originY={16}
              />
              <Rect x={50} y={14} width={13} height={10} rx={1.5} fill="#B4482B" />
              <Rect
                x={72}
                y={13}
                width={13}
                height={10}
                rx={1.5}
                fill="#2E5E4E"
                rotation={-3}
                originX={78}
                originY={18}
              />
              <Rect
                x={94}
                y={9}
                width={13}
                height={10}
                rx={1.5}
                fill="#E8A13D"
                rotation={-5}
                originX={100}
                originY={14}
              />
            </G>
            {/* ridges */}
            <Path
              d="M0 96 L48 58 L84 84 L128 44 L166 76 L210 40 L254 74 L296 52 L338 82 L376 60 L414 84 L414 150 L0 150 Z"
              fill="url(#sn)"
            />
            <Path
              d="M0 118 L70 100 L150 118 L240 98 L330 120 L414 104 L414 150 L0 150 Z"
              fill="#3A6D5B"
            />
            <Path d="M0 138 L110 126 L230 140 L340 128 L414 138 L414 150 L0 150 Z" fill="#1F4237" />
            {/* flight line */}
            <Path
              d="M40 34 C 150 52, 280 86, 396 122"
              fill="none"
              stroke="#E8734D"
              strokeWidth={1.8}
              strokeDasharray="1 8"
              strokeLinecap="round"
            />
            <Circle cx={40} cy={34} r={3.4} fill="#E8734D" />
            <Circle cx={396} cy={122} r={3.4} fill="#E8734D" />
            <SvgText
              x={40}
              y={22}
              fontSize={7.5}
              fill="#C9DAE3"
              letterSpacing={1}
              fontFamily="monospace"
            >
              BILLING 2,400m
            </SvgText>
            <SvgText
              x={398}
              y={112}
              textAnchor="end"
              fontSize={7.5}
              fill="#DCE6DE"
              letterSpacing={1}
              fontFamily="monospace"
            >
              BIR 1,525m
            </SvgText>
          </Svg>
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: [{ translateX }, { translateY }],
            }}
          >
            <Glider size={gliderSize} />
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}
