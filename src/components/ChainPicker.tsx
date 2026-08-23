import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { CHAIN_LIST, type ChainId } from '../wallet/chains';

type Props = {
  selected: ChainId;
  onSelect: (chainId: ChainId) => void;
};

export function ChainPicker({ selected, onSelect }: Props) {
  return (
    <View style={styles.row}>
      {CHAIN_LIST.map((chain) => (
        <Pressable
          key={chain.id}
          onPress={() => onSelect(chain.id)}
          style={[styles.chip, selected === chain.id && styles.chipOn]}
        >
          <Text style={[styles.chipText, selected === chain.id && styles.chipTextOn]}>{chain.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.muted,
    fontWeight: '700',
  },
  chipTextOn: {
    color: colors.accent,
  },
});
