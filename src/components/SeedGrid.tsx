import { Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';

type Props = {
  phrase: string;
};

function seedStyles({ colors, radius, spacing }: Theme) {
  return {
    grid: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: spacing.sm,
    },
    cell: {
      width: '47%' as const,
      flexGrow: 1,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
    },
    index: {
      color: colors.muted,
      width: 22,
      fontVariant: ['tabular-nums' as const],
    },
    word: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600' as const,
    },
  };
}

export function SeedGrid({ phrase }: Props) {
  const styles = useThemedStyles(seedStyles);
  const words = phrase.split(' ').filter(Boolean);
  return (
    <View style={styles.grid}>
      {words.map((word, index) => (
        <View key={`${index}-${word}`} style={styles.cell}>
          <Text style={styles.index}>{index + 1}</Text>
          <Text style={styles.word}>{word}</Text>
        </View>
      ))}
    </View>
  );
}
