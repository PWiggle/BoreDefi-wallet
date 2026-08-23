import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

export function SettingsRow({
  label,
  detail,
  onPress,
  danger,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={styles.copy}>
        <Text style={[styles.label, danger && styles.danger]}>{label}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: colors.text,
    fontWeight: '700',
  },
  detail: {
    color: colors.muted,
    fontSize: 13,
  },
  chevron: {
    color: colors.muted,
    fontSize: 22,
    lineHeight: 22,
  },
  danger: {
    color: colors.danger,
  },
});
