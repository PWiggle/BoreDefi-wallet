import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useLedger } from '../context/LedgerContext';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { formatNative } from '../wallet/format';
import { LEDGER_ETH_PATH } from '../wallet/ledger';
import { LEDGER_SOL_PATH } from '../wallet/ledger-dmk';
import { fetchBalance } from '../wallet/rpc';
import { formatSol } from '../wallet/solana/format';
import { getSolBalance } from '../wallet/solana/rpc';

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
    ok: { color: colors.accent, lineHeight: 20 },
    row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  };
}

/** The message the "Test signing" buttons ask the Ledger to sign. Harmless: it authorises nothing. */
export const LEDGER_TEST_MESSAGE = 'BoreDefi Wallet Ledger test. This signature does not move funds.';

export function LedgerScreen() {
  const styles = useThemedStyles(ledgerStyles);
  const { selectedChain } = useWallet();
  const ledger = useLedger();
  const { account, watch, connecting, error, transportKind, gapMessage, bleEnabled, prompt, connect, connectBle, disconnect, forget } = ledger;
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [solBalance, setSolBalance] = useState<bigint | null>(null);
  const transportLabel =
    transportKind === 'webhid' ? 'WebHID (USB)' : transportKind === 'ble' ? 'Bluetooth (Nano X)' : 'Not available on this runtime';
  const ethAddress = account?.address ?? watch?.ethAddress ?? null;
  const solAddress = account?.solanaAddress ?? watch?.solanaAddress ?? null;
  const watchOnly = !account && Boolean(watch);

  // Watch-only balances: read from the public address, no Ledger needed.
  useEffect(() => {
    let alive = true;
    setEthBalance(null);
    if (ethAddress) {
      fetchBalance(ethAddress, selectedChain.id)
        .then((value) => alive && setEthBalance(value))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [ethAddress, selectedChain.id]);
  useEffect(() => {
    let alive = true;
    setSolBalance(null);
    if (solAddress) {
      getSolBalance(solAddress)
        .then((value) => alive && setSolBalance(value))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [solAddress]);

  const run = (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setResult(null);
    action()
      .then((message) => setResult(message))
      .catch(() => undefined)
      .finally(() => setBusy(null));
  };

  return (
    <Screen title="Ledger" subtitle="Hardware signing for send, swap, and bridge.">
      <ErrorBanner message={error} />
      <View style={styles.card}>
        <Text style={styles.label}>Transport</Text>
        <Text style={styles.value}>{transportLabel}</Text>
        {account?.deviceName ?? watch?.deviceName ? (
          <>
            <Text style={styles.label}>Device</Text>
            <Text style={styles.value}>
              {account?.deviceName ?? watch?.deviceName}
              {watchOnly ? ' (not connected, watch-only)' : account ? ' (connected)' : ''}
            </Text>
          </>
        ) : null}
        <Text style={styles.label}>Ethereum / EVM ({LEDGER_ETH_PATH})</Text>
        <Text style={styles.value} selectable>
          {ethAddress ?? 'Not connected'}
        </Text>
        {ethAddress && ethBalance !== null ? (
          <Text style={styles.help}>
            {formatNative(ethBalance)} {selectedChain.symbol} on {selectedChain.name}
          </Text>
        ) : null}
        {bleEnabled ? (
          <>
            <Text style={styles.label}>Solana ({LEDGER_SOL_PATH})</Text>
            <Text style={styles.value} selectable>
              {solAddress ?? (ethAddress ? 'Open the Solana app on the Ledger, then reconnect' : 'Not connected')}
            </Text>
            {solAddress && solBalance !== null ? <Text style={styles.help}>{formatSol(solBalance)} SOL</Text> : null}
          </>
        ) : null}
        {watch?.verifiedAt ? <Text style={styles.ok}>Address checked on the Ledger screen.</Text> : null}
      </View>
      {prompt ? <Text style={styles.gap}>{prompt}</Text> : null}
      {result ? <Text style={styles.ok}>{result}</Text> : null}
      {account ? (
        <Button label="Disconnect Ledger" variant="secondary" onPress={disconnect} />
      ) : bleEnabled ? (
        <Button
          label={watch ? 'Reconnect Ledger (Bluetooth)' : 'Connect Ledger (Bluetooth)'}
          onPress={() => connectBle().catch(() => undefined)}
          loading={connecting}
        />
      ) : (
        <Button
          label={transportKind === 'webhid' ? 'Connect Ledger (USB)' : 'Connect Ledger'}
          onPress={() => connect().catch(() => undefined)}
          loading={connecting}
          disabled={transportKind !== 'webhid'}
        />
      )}
      {bleEnabled && ethAddress ? (
        <View style={styles.row}>
          <Button
            label="Check ETH address on Ledger"
            variant="secondary"
            loading={busy === 'verify-eth'}
            disabled={Boolean(busy)}
            onPress={() => run('verify-eth', async () => `ETH address matches the Ledger: ${await ledger.verifyOnDevice('eth')}`)}
          />
          {solAddress ? (
            <Button
              label="Check SOL address on Ledger"
              variant="secondary"
              loading={busy === 'verify-sol'}
              disabled={Boolean(busy)}
              onPress={() => run('verify-sol', async () => `SOL address matches the Ledger: ${await ledger.verifyOnDevice('solana')}`)}
            />
          ) : null}
          <Button
            label="Test sign (ETH message)"
            variant="ghost"
            loading={busy === 'sign-eth'}
            disabled={Boolean(busy)}
            onPress={() =>
              run('sign-eth', async () => {
                await ledger.signEthMessage(LEDGER_TEST_MESSAGE);
                return 'ETH message signed on the Ledger and checked against your Ledger address.';
              })
            }
          />
          {solAddress ? (
            <Button
              label="Test sign (SOL message)"
              variant="ghost"
              loading={busy === 'sign-sol'}
              disabled={Boolean(busy)}
              onPress={() =>
                run('sign-sol', async () => {
                  await ledger.signSolanaMessage(LEDGER_TEST_MESSAGE);
                  return 'Solana message signed on the Ledger and checked against your Ledger address.';
                })
              }
            />
          ) : null}
          <Button
            label="Copy ETH address"
            variant="ghost"
            onPress={() => {
              void Clipboard.setStringAsync(ethAddress);
              setResult('ETH address copied.');
            }}
          />
          {watch ? (
            <Button label="Forget this Ledger" variant="ghost" disabled={Boolean(busy)} onPress={() => void forget()} />
          ) : null}
        </View>
      ) : null}
      {gapMessage ? (
        <Text style={styles.gap}>{gapMessage}</Text>
      ) : (
        <Text style={styles.help}>
          Unlock the Ledger and open the Ethereum app (or the Solana app for Solana), then confirm. While it is
          connected, Send, Swap, Bridge and Solana Send sign on the Ledger. When it is not connected, the addresses
          stay here as a watch-only account. The keys never leave the Ledger.
        </Text>
      )}
      <Text style={styles.help}>
        {bleEnabled
          ? 'Nano X over Bluetooth via Ledger Device Management Kit. Keep the Ledger unlocked and close to the phone. BoreDefi never asks for your Ledger\u2019s 24 words.'
          : 'Working path: Chrome extension or Expo web via WebHID. Bluetooth (Nano X) is in test builds only for now.'}
      </Text>
    </Screen>
  );
}
