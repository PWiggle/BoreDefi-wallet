import { Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { WEB_TEST_BANNER } from '../web-test-copy';
import { isWebTestBuild } from '../web-test';

function bannerStyles({ colors, spacing }: Theme) {
  return {
    banner: {
      backgroundColor: colors.bannerSurface,
      borderBottomColor: colors.warning,
      borderBottomWidth: 2,
      gap: 4,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    kicker: {
      color: colors.warning,
      fontSize: 11,
      fontWeight: '800' as const,
      letterSpacing: 1,
    },
    copy: {
      color: colors.bannerText,
      fontSize: 13,
      lineHeight: 18,
    },
  };
}

export function WebTestBanner() {
  const styles = useThemedStyles(bannerStyles);
  if (!isWebTestBuild()) {
    return null;
  }
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.kicker}>TEST-ONLY</Text>
      <Text style={styles.copy}>{WEB_TEST_BANNER}</Text>
    </View>
  );
}
