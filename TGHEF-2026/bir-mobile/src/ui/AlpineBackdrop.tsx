import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient as SvgGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

/**
 * The festival's expressive background — a dawn sky over frigid snow-capped
 * peaks and the lush pine valley, with prayer flags and the Billing→Bir
 * flight line. Sits behind the hero content; the scene fills the width and the
 * given height, its peaks/valley anchored to the bottom so content can float
 * over the sky above them.
 */
export function AlpineBackdrop({ height }: { height: number }) {
  const w = Dimensions.get('window').width;
  const h = height;
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
      <LinearGradient
        colors={['#0C161D', '#17232B', '#22403A']}
        locations={[0, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Svg
        width={w}
        height={h}
        viewBox={`0 0 400 ${Math.round((400 / w) * h)}`}
        preserveAspectRatio="xMidYMax slice"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <SvgGradient id="peak" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#EAF1F5" />
            <Stop offset="0.42" stopColor="#B9CCD8" />
            <Stop offset="1" stopColor="#3E6B8C" />
          </SvgGradient>
        </Defs>
        {(() => {
          const H = Math.round((400 / w) * h);
          const base = H; // valley base
          const ridge = H - 26;
          const peakTop = H - 150;
          return (
            <G>
              {/* prayer flags */}
              <G>
                <Path
                  d={`M40 ${peakTop - 96} C 150 ${peakTop - 82}, 250 ${peakTop - 82}, 360 ${peakTop - 96}`}
                  stroke="#3E6B8C"
                  strokeWidth={1.4}
                  fill="none"
                  opacity={0.5}
                />
                <Rect x={120} y={peakTop - 88} width={14} height={11} rx={2} fill="#3E6B8C" />
                <Rect x={168} y={peakTop - 84} width={14} height={11} rx={2} fill="#B4482B" />
                <Rect x={216} y={peakTop - 84} width={14} height={11} rx={2} fill="#2E5E4E" />
                <Rect x={264} y={peakTop - 86} width={14} height={11} rx={2} fill="#E8A13D" />
              </G>
              {/* flight line + glider */}
              <Path
                d={`M40 ${peakTop - 40} C 150 ${peakTop - 58}, 260 ${peakTop - 20}, 360 ${peakTop - 64}`}
                stroke="#E8A13D"
                strokeWidth={2}
                strokeDasharray="6 7"
                fill="none"
                opacity={0.85}
              />
              <G transform={`translate(230 ${peakTop - 38}) scale(1.5) rotate(9)`}>
                <Path
                  d="M-17 0 C -9 -9, 9 -9, 17 0"
                  fill="none"
                  stroke="#E8A13D"
                  strokeWidth={3.4}
                  strokeLinecap="round"
                />
                <Path d="M-13 -1 L0 9 M13 -1 L0 9" stroke="#F7F8F5" strokeWidth={1} />
                <Circle cx={0} cy={10.5} r={2.3} fill="#7FE0A6" />
              </G>
              {/* frigid snow peaks */}
              <Path
                d={`M0 ${base} L0 ${peakTop + 70} L90 ${peakTop} L180 ${peakTop + 70} L250 ${peakTop - 6} L330 ${peakTop + 60} L400 ${peakTop + 20} L400 ${base} Z`}
                fill="url(#peak)"
                opacity={0.96}
              />
              <Path
                d={`M250 ${peakTop - 6} L232 ${peakTop + 24} L242 ${peakTop + 20} L250 ${peakTop + 34} L259 ${peakTop + 18} L270 ${peakTop + 24} Z`}
                fill="#F5F9FB"
              />
              <Path
                d={`M90 ${peakTop} L76 ${peakTop + 24} L86 ${peakTop + 20} L90 ${peakTop + 32} L97 ${peakTop + 18} L108 ${peakTop + 24} Z`}
                fill="#F5F9FB"
              />
              {/* lush pine ridges */}
              <Path
                d={`M0 ${base} L0 ${ridge - 34} L110 ${ridge - 58} L230 ${ridge - 30} L330 ${ridge - 52} L400 ${ridge - 34} L400 ${base} Z`}
                fill="#2E5E4E"
              />
              <Path
                d={`M0 ${base} L0 ${ridge} L120 ${ridge - 20} L260 ${ridge + 4} L360 ${ridge - 14} L400 ${ridge} L400 ${base} Z`}
                fill="#20473B"
              />
            </G>
          );
        })()}
      </Svg>
    </View>
  );
}
