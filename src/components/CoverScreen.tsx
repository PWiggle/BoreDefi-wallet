import { type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverImage } from '../brand';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { COVER_BACKGROUND } from '../theme';

type Props = {
  footer: ReactNode;
  /** Welcome only. Create, import, PIN, and Home keep the status bar. */
  statusBarHidden?: boolean;
};

function coverStyles({ spacing }: Theme) {
  return {
    root: {
      backgroundColor: COVER_BACKGROUND,
      flex: 1,
    },
    art: {
      bottom: 0,
      left: 0,
      position: 'absolute' as const,
      right: 0,
      top: 0,
    },
    footer: {
      gap: spacing.sm,
      marginTop: 'auto' as const,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
  };
}

export function CoverScreen({ footer, statusBarHidden = false }: Props) {
  const styles = useThemedStyles(coverStyles);
  const { width, height } = useWindowDimensions();
  return (
    <View style={styles.root} testID="boredefi-cover">
      <StatusBar hidden={statusBarHidden} style="light" />
      <Image
        accessibilityLabel="BoreDefi"
        resizeMode="contain"
        source={coverImage}
        style={[styles.art, { width, height }]}
      />
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {footer}
      </SafeAreaView>
    </View>
  );
}
