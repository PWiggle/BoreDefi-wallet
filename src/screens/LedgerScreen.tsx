import { Text, View } from 'react-native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useLedger } from '../context/LedgerContext';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { LEDGER_ETH_PATH } from '../wallet/ledger';
import { LEDGER_SOL_PATH } from '../wallet/ledger-dmk';

function ledgerStyles({ colors, type, card, spacing }: Theme) {
  return {
    card: {
      ...card,
      gap: spacing.sm,
    },
    label: type.label,
    value: { color: colors.text, fontWeight: '700' as const },
    help: type.subtitle,
    gap: { color: colors.warning, lineHeight: 20 },
  };
}

export function LedgerScreen() {
  const styles = useThemedStyles(ledgerStyles);
  const { account, connecting, error, transportKind, gapMessage, bleEnabled, prompt, connect, connectBle, disconnect } = useLedger();
  const transportLabel =
    transportKind === 'webhid' ? 'WebHID (USB)' : transportKind === 'ble' ? 'Bluetooth (Nano X)' : 'Not available on this runtime';

  return (
    <Screen title="Ledger" subtitle="Hardware signing for send, swap, and bridge.">
      <ErrorBanner message={error} />
      <View style={styles.card}>
        <Text style={styles.label}>Transport</Text>
        <Text style={styles.value}>{transportLabel}</Text>
        {account?.deviceName ? (
          <>
            <Text style={styles.label}>Device</Text>
            <Text style={styles.value}>{account.deviceName}</Text>
          </>
        ) : null}
        <Text style={styles.label}>Derivation</Text>
        <Text style={styles.value}>{LEDGER_ETH_PATH}</Text>
        <Text style={styles.label}>Device address</Text>
        <Text style={styles.value}>{account?.address ?? 'Not connected'}</Text>
        {bleEnabled ? (
          <>
            <Text style={styles.label}>Solana ({LEDGER_SOL_PATH})</Text>
            <Text style={styles.value}>
              {account ? account.solanaAddress ?? 'Open the Solana app on the Ledger, then reconnect' : 'Not connected'}
            </Text>
          </>
        ) : null}
      </View>
      {prompt ? <Text style={styles.gap}>{prompt}</Text> : null}
      {account ? (
        <Button label="Disconnect Ledger" variant="secondary" onPress={disconnect} />
      ) : (
        bleEnabled ? (
          <Button label="Connect Ledger (Bluetooth)" onPress={() => connectBle().catch(() => undefined)} loading={connecting} />
        ) : (
          <Button
            label={transportKind === 'webhid' ? 'Connect Ledger (USB)' : 'Connect Ledger'}
            onPress={() => connect().catch(() => undefined)}
            loading={connecting}
            disabled={transportKind !== 'webhid'}
          />
        )
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
        {bleEnabled
          ? 'Nano X over Bluetooth via Ledger Device Management Kit. Keep the Ledger unlocked and close to the phone.'
          : 'Working path: Chrome extension or Expo web via WebHID. Bluetooth (Nano X) is in test builds only for now.'}
      </Text>
    </Screen>
  );
}
