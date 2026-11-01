import { ActivityIndicator, Text, View } from 'react-native';

import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';

function securingStyles({ colors, spacing, type }: Theme) {
  return {
    wrap: {
      alignItems: 'center' as const,
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    label: {
      ...type.subtitle,
      color: colors.text,
      fontWeight: '700' as const,
      textAlign: 'center' as const,
    },
  };
}

export function SecuringWallet() {
  const { colors } = useTheme();
  const styles = useThemedStyles(securingStyles);
  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.label}>Securing your wallet…</Text>
    </View>
  );
}
