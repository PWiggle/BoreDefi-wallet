import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from 'react-native';

import { useTheme } from '../context/ThemeContext';
import { radius, spacing } from '../theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

type Props = PressableProps & {
  label: string;
  variant?: Variant;
  loading?: boolean;
};

export function Button({ label, variant = 'primary', loading, disabled, style, ...rest }: Props) {
  const { colors } = useTheme();
  const palette = {
    primary: { background: colors.accent, text: colors.accentText, border: colors.accent },
    secondary: { background: colors.surfaceAlt, text: colors.text, border: colors.border },
    danger: { background: colors.danger, text: colors.dangerHoldText, border: colors.danger },
    ghost: { background: 'transparent', text: colors.muted, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={(state) => [
        styles.base,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          opacity: disabled || loading ? 0.45 : state.pressed ? 0.85 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} />
      ) : (
        <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
  },
});
