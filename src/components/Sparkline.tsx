import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { useTheme } from '../context/ThemeContext';

export function Sparkline({
  points,
  width = 72,
  height = 28,
  color,
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (points.length < 2) {
    return <View style={{ width, height }} />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((value - min) / span) * (height - 2);
      return `${x},${y}`;
    })
    .join(' ');
  const { colors } = useTheme();
  const rising = points[points.length - 1]! >= points[0]!;
  return (
    <Svg width={width} height={height}>
      <Polyline
        points={path}
        fill="none"
        stroke={color ?? (rising ? colors.accent : colors.danger)}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
