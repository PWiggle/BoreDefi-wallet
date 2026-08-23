import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

type Props = {
  phrase: string;
};

export function SeedGrid({ phrase }: Props) {
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

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cell: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  index: {
    color: colors.muted,
    width: 22,
    fontVariant: ['tabular-nums'],
  },
  word: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
