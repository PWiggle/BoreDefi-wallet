import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../theme';
import { WEB_TEST_BANNER } from '../web-test-copy';
import { isWebTestBuild } from '../web-test';

export function WebTestBanner() {
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

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#3B2A08',
    borderBottomColor: colors.warning,
    borderBottomWidth: 2,
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  kicker: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  copy: {
    color: '#F8E3B0',
    fontSize: 13,
    lineHeight: 18,
  },
});
