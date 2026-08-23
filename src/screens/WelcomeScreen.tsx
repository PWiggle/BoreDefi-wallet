import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import { colors, spacing } from '../theme';

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
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Phase 3</Text>
        <Text style={styles.cardBody}>
          Create or import a BIP39 wallet, back up the seed, then send, receive, swap, stake,
          bridge, view NFTs, and open WalletConnect-compatible dApps on Ethereum, Base, Arbitrum,
          Optimism, Polygon, BNB Chain, and Avalanche.
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
});
