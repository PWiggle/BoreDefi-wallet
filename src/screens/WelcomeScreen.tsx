import { Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { WEB_TEST_BANNER } from '../web-test-copy';
import { isWebTestBuild } from '../web-test';

function welcomeStyles({ colors, type, card, spacing }: Theme) {
  return {
    card: {
      ...card,
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    cardTitle: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: '800' as const,
      letterSpacing: 1,
      textTransform: 'uppercase' as const,
    },
    cardBody: type.subtitle,
    warn: {
      backgroundColor: colors.bannerSurface,
      borderColor: colors.warning,
      borderRadius: 16,
      borderWidth: 1,
      gap: spacing.sm,
      marginTop: spacing.sm,
      padding: spacing.md,
    },
    warnTitle: {
      color: colors.warning,
      fontSize: 12,
      fontWeight: '800' as const,
      letterSpacing: 1,
      textTransform: 'uppercase' as const,
    },
  };
}

export function WelcomeScreen() {
  const styles = useThemedStyles(welcomeStyles);
  const { startCreate, startImport } = useWallet();

  return (
    <Screen
      title="BoreDefi"
      subtitle="Non-custodial wallet. Your recovery phrase stays on this device and is never sent to a server."
      footer={
        <>
          <Button label="Create new wallet" onPress={startCreate} />
          <Button label="Import recovery phrase" variant="secondary" onPress={startImport} />
        </>
      }
    >
      {isWebTestBuild() ? (
        <View style={styles.warn}>
          <Text style={styles.warnTitle}>TEST-ONLY</Text>
          <Text style={styles.cardBody}>{WEB_TEST_BANNER}</Text>
        </View>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Onchain wallet</Text>
        <Text style={styles.cardBody}>
          Send, swap, stake, bridge, NFTs, live CoinGecko markets, and an in-app browser. Keys stay
          on device. No fiat on-ramp.
        </Text>
      </View>
    </Screen>
  );
}
