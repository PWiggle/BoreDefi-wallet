import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(255, 92, 122, 0.12)',
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
});
