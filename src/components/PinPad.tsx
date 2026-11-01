import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';

type PinUpdater = (current: string) => string;

type Props = {
  value: string;
  onChange: (updater: PinUpdater) => void;
  maxLength?: number;
  disabled?: boolean;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

function pinStyles({ colors, radius, spacing }: Theme) {
  return {
    wrap: {
      gap: spacing.lg,
      alignItems: 'center' as const,
    },
    dots: {
      flexDirection: 'row' as const,
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
      width: '100%' as const,
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      justifyContent: 'center' as const,
      gap: spacing.sm,
    },
    key: {
      width: '30%' as const,
      maxWidth: 96,
      height: 64,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
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
      fontWeight: '700' as const,
    },
  };
}

export function PinPad({ value, onChange, maxLength = 6, disabled = false }: Props) {
  const styles = useThemedStyles(pinStyles);
  const press = (key: string) => {
    if (disabled) {
      return;
    }
    onChange((current) => {
      if (key === '⌫') {
        return current.slice(0, -1);
      }
      if (!key || current.length >= maxLength) {
        return current;
      }
      return `${current}${key}`;
    });
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
            disabled={!key || disabled}
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
