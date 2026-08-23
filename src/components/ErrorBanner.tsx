import { Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';

function errorStyles({ colors, radius, spacing }: Theme) {
  return {
    banner: {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.danger,
      borderWidth: 1,
      borderRadius: radius.sm,
      padding: spacing.md,
    },
    text: {
      color: colors.danger,
      fontSize: 14,
      lineHeight: 20,
    },
  };
}

export function ErrorBanner({ message }: { message?: string | null }) {
  const styles = useThemedStyles(errorStyles);
  if (!message) {
    return null;
  }
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}
