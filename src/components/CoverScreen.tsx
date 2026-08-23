import { type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverImage } from '../brand';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { COVER_BACKGROUND } from '../theme';

type Props = {
  footer: ReactNode;
};

function coverStyles({ spacing }: Theme) {
  return {
    root: {
      backgroundColor: COVER_BACKGROUND,
      flex: 1,
    },
    art: {
      flex: 1,
      width: '100%' as const,
    },
    footer: {
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
  };
}

export function CoverScreen({ footer }: Props) {
  const styles = useThemedStyles(coverStyles);
  return (
    <View style={styles.root} testID="boredefi-cover">
      <StatusBar style="light" />
      <Image
        accessibilityLabel="BoreDefi"
        resizeMode="contain"
        source={coverImage}
        style={styles.art}
      />
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {footer}
      </SafeAreaView>
    </View>
  );
}
