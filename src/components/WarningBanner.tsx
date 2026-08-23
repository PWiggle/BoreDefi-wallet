import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

export function WarningBanner({
  title,
  lines,
  danger,
}: {
  title?: string;
  lines: string[];
  danger?: boolean;
}) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <View style={[styles.box, danger && styles.boxDanger]}>
      {title ? <Text style={[styles.title, danger && styles.titleDanger]}>{title}</Text> : null}
      {lines.map((line) => (
        <Text key={line} style={[styles.line, danger && styles.lineDanger]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#2A2108',
    borderColor: colors.warning,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 6,
    padding: spacing.md,
  },
  boxDanger: {
    backgroundColor: '#2A0610',
    borderColor: colors.danger,
  },
  title: {
    color: colors.warning,
    fontWeight: '800',
  },
  titleDanger: {
    color: colors.danger,
  },
  line: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 18,
  },
  lineDanger: {
    color: colors.danger,
  },
});
