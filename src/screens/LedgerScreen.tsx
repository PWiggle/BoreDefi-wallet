import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useLedger } from '../context/LedgerContext';
import { card, colors, spacing, type } from '../theme';
import { LEDGER_ETH_PATH } from '../wallet/ledger';

export function LedgerScreen() {
  const { account, connecting, error, transportKind, gapMessage, connect, disconnect } = useLedger();

  return (
    <Screen title="Ledger" subtitle="Hardware signing for send, swap, and bridge.">
      <ErrorBanner message={error} />
      <View style={styles.card}>
        <Text style={styles.label}>Transport</Text>
        <Text style={styles.value}>{transportKind === 'webhid' ? 'WebHID (USB)' : 'Not available on this runtime'}</Text>
        <Text style={styles.label}>Derivation</Text>
        <Text style={styles.value}>{LEDGER_ETH_PATH}</Text>
        <Text style={styles.label}>Device address</Text>
        <Text style={styles.value}>{account?.address ?? 'Not connected'}</Text>
      </View>
      {account ? (
        <Button label="Disconnect Ledger" variant="secondary" onPress={disconnect} />
      ) : (
        <Button
          label={transportKind === 'webhid' ? 'Connect Ledger (USB)' : 'Connect Ledger'}
          onPress={() => connect().catch(() => undefined)}
          loading={connecting}
          disabled={transportKind !== 'webhid'}
        />
      )}
      {gapMessage ? (
        <Text style={styles.gap}>{gapMessage}</Text>
      ) : (
        <Text style={styles.help}>
          Unlock the device, open the Ethereum app, then confirm. Send, swap, and bridge use this
          address while it stays connected. The seed never leaves the Ledger.
        </Text>
      )}
      <Text style={styles.help}>
        Working path: Chrome extension or Expo web via WebHID. Native Android/iOS USB and BLE are
        not shipped in this Expo prebuild — see README.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    ...card,
    gap: spacing.sm,
  },
  label: type.label,
  value: { color: colors.text, fontWeight: '700' },
  help: type.subtitle,
  gap: { color: colors.warning, lineHeight: 20 },
});
