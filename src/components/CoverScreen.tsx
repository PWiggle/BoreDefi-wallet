import { type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image, View } from 'react-native';
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
    // The art is fitted into the space above the footer, so the footer text can never sit on the logo,
    // whatever the screen height (iPhone SE, tall Androids, web with the test banner).
    art: {
      flex: 1,
      minHeight: 0,
      width: '100%' as const,
    },
    footer: {
      gap: spacing.sm,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
  };
}

export function CoverScreen({ footer, statusBarHidden = false }: Props) {
  const styles = useThemedStyles(coverStyles);
  return (
    <View style={styles.root} testID="boredefi-cover">
      <StatusBar hidden={statusBarHidden} style="light" />
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
