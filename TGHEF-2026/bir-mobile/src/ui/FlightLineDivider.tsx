import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { palette } from './tokens';

/**
 * The Billing→Bir "flight line": a dashed descending arc, used in headers
 * and empty states (docs/BRAND.md motif).
 */
export function FlightLineDivider({
  width = 280,
  color = palette.marigold,
}: {
  width?: number;
  color?: string;
}) {
  const height = width * 0.18;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height} viewBox="0 0 280 50">
        <Path
          d="M6 8 C 90 4, 190 18, 274 44"
          stroke={color}
          strokeWidth={2.5}
          strokeDasharray="7 6"
          strokeLinecap="round"
          fill="none"
        />
        <Path d="M268 36 L 276 45 L 264 45 Z" fill={color} />
      </Svg>
    </View>
  );
}
