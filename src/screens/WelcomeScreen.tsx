import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import { colors, spacing } from '../theme';
import { WEB_TEST_BANNER } from '../web-test-copy';
import { isWebTestBuild } from '../web-test';

export function WelcomeScreen() {
  const { startCreate, startImport } = useWallet();

  return (
    <Screen
      title="BoreDefi Wallet"
      subtitle="A non-custodial wallet. Your recovery phrase stays on this device and is never sent to a server."
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
        <Text style={styles.cardTitle}>Phase 4</Text>
        <Text style={styles.cardBody}>
          Non-custodial wallet with send, swap, stake, bridge, NFTs, Discover/Market, an in-app
          dApp browser, a Chrome extension, and Ledger signing over WebHID. No fiat on-ramp.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: {
    color: colors.accent,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  cardBody: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  warn: {
    marginTop: spacing.lg,
    backgroundColor: '#3B2A08',
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  warnTitle: {
    color: colors.warning,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontSize: 12,
  },
});
