import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

type Props = {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function PinPad({ value, onChange, maxLength = 6 }: Props) {
  const press = (key: string) => {
    if (key === '⌫') {
      onChange(value.slice(0, -1));
      return;
    }
    if (!key || value.length >= maxLength) {
      return;
    }
    onChange(`${value}${key}`);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.dots}>
        {Array.from({ length: maxLength }).map((_, index) => (
          <View key={index} style={[styles.dot, index < value.length && styles.dotOn]} />
        ))}
      </View>
      <View style={styles.keys}>
        {KEYS.map((key) => (
          <Pressable
            key={key || 'blank'}
            disabled={!key}
            onPress={() => press(key)}
            style={({ pressed }) => [
              styles.key,
              !key && styles.blank,
              pressed && key ? styles.keyPressed : null,
            ]}
          >
            <Text style={styles.keyLabel}>{key}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dotOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  keys: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  key: {
    width: '30%',
    maxWidth: 96,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    opacity: 0.7,
  },
  blank: {
    backgroundColor: 'transparent',
  },
  keyLabel: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
});
