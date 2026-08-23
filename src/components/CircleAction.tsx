import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, spacing } from '../theme';

type Name = 'send' | 'receive' | 'swap' | 'stake' | 'bridge';

const ICONS: Record<Name, string> = {
  send: 'M12 19V6M12 6 7 11M12 6l5 5',
  receive: 'M12 5v13M12 18l5-5M12 18 7 13',
  swap: 'M7 8h11M18 8l-3-3M18 8l-3 3M17 16H6M6 16l3-3M6 16l3 3',
  stake: 'M12 4 14.2 9.2 20 10l-4 3.8.9 5.7L12 16.8 7.1 19.5 8 13.8 4 10l5.8-.8L12 4Z',
  bridge: 'M5 12h14M8 8 5 12l3 4M16 8l3 4-3 4',
};

export function CircleAction({
  label,
  name,
  onPress,
}: {
  label: string;
  name: Name;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.wrap}>
      <View style={styles.circle}>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Path
            d={ICONS[name]}
            stroke={colors.accent}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={name === 'stake' ? 'none' : undefined}
          />
        </Svg>
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  circle: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
});
