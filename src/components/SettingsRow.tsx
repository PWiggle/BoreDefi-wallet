import { Pressable, Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';

function rowStyles({ colors, radius, spacing }: Theme) {
  return {
    row: {
      alignItems: 'center' as const,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: 'row' as const,
      gap: spacing.md,
      padding: spacing.md,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
    label: {
      color: colors.text,
      fontWeight: '700' as const,
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
  };
}

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
  const styles = useThemedStyles(rowStyles);
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
