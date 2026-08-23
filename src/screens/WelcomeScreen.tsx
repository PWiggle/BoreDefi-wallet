import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import { card, colors, spacing, type } from '../theme';
import { WEB_TEST_BANNER } from '../web-test-copy';
import { isWebTestBuild } from '../web-test';

export function WelcomeScreen() {
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

const styles = StyleSheet.create({
  card: {
    ...card,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cardTitle: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cardBody: type.subtitle,
  warn: {
    backgroundColor: '#3B2A08',
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
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
