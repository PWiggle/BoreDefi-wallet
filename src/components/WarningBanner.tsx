import { Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';

function warningStyles({ colors, radius, spacing }: Theme) {
  return {
    box: {
      backgroundColor: colors.warningSurface,
      borderColor: colors.warning,
      borderRadius: radius.md,
      borderWidth: 1,
      gap: 6,
      padding: spacing.md,
    },
    boxDanger: {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.danger,
    },
    title: {
      color: colors.warning,
      fontWeight: '800' as const,
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
  };
}

export function WarningBanner({
  title,
  lines,
  danger,
}: {
  title?: string;
  lines: string[];
  danger?: boolean;
}) {
  const styles = useThemedStyles(warningStyles);
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
