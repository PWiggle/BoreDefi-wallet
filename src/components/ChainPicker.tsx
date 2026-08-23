import { Pressable, Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { CHAIN_LIST, type ChainId } from '../wallet/chains';

type Props = {
  selected: ChainId;
  onSelect: (chainId: ChainId) => void;
};

function pickerStyles({ colors, radius, spacing }: Theme) {
  return {
    row: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
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
      fontWeight: '700' as const,
    },
    chipTextOn: {
      color: colors.accent,
    },
  };
}

export function ChainPicker({ selected, onSelect }: Props) {
  const styles = useThemedStyles(pickerStyles);
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
