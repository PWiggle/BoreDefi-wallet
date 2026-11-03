import { useCallback, useEffect, useState } from 'react';
import { Modal, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { isAddress } from 'ethers';

import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ErrorBanner } from '../components/ErrorBanner';
import { ProtectedReauth } from '../components/ProtectedReauth';
import { Screen } from '../components/Screen';
import { WarningBanner } from '../components/WarningBanner';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { CHAINS, type ChainId } from '../wallet/chains';
import {
  addAddressBookEntry,
  approvalWindowRemainingMs,
  closeApprovalWindow,
  DEFAULT_PROTECTED_POLICY,
  openApprovalWindow,
  removeAddressBookEntry,
  type ProtectedPolicy,
} from '../wallet/protected-policy';
import { revokeCalldata, scanProtectedApprovals, type LiveApproval } from '../wallet/protected-approvals';
import { connectedWallet, getProvider } from '../wallet/rpc';
import { loadProtectedPolicy, saveProtectedPolicy } from '../wallet/storage';
import { friendlyTxError } from '../wallet/tx-errors';
import { PROTECTED_ASSETS, type ProtectedAsset } from '../wallet/yuga-allowlist';

function styles_({ colors, card, field, spacing, type }: Theme) {
  return {
    section: { ...type.label, marginTop: spacing.sm },
    card: { ...card, gap: spacing.sm },
    row: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: spacing.sm, justifyContent: 'space-between' as const },
    copy: { flex: 1, gap: 2 },
    label: { color: colors.text, fontWeight: '700' as const },
    help: type.meta,
    mono: { color: colors.text, fontFamily: 'monospace', fontSize: 12 },
    on: { color: colors.danger, fontWeight: '800' as const },
    input: field,
    backdrop: { backgroundColor: colors.overlay, flex: 1, justifyContent: 'center' as const, padding: spacing.lg },
    sheet: { ...card, gap: spacing.sm },
  };
}

function minutesLeft(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function ProtectedCollectionsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(styles_);
  const { session } = useWallet();
  const [policy, setPolicy] = useState<ProtectedPolicy>(DEFAULT_PROTECTED_POLICY);
  const [now, setNow] = useState(Date.now());
  const [pendingAllow, setPendingAllow] = useState<ProtectedAsset | null>(null);
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [approvals, setApprovals] = useState<LiveApproval[] | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [revoking, setRevoking] = useState<LiveApproval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadProtectedPolicy().then(setPolicy);
    }, []),
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const save = async (next: ProtectedPolicy) => {
    setPolicy(next);
    await saveProtectedPolicy(next);
  };

  const scan = useCallback(async () => {
    if (!session) {
      return;
    }
    setScanning(true);
    setError(null);
    try {
      const result = await scanProtectedApprovals({
        owner: session.address,
        ethLogsBase: CHAINS[1].nftApi,
        call: (chainId, to, data) => getProvider(chainId as ChainId).call({ to, data }),
      });
      setApprovals(result.approvals);
      const notes: string[] = [];
      if (!result.logsChecked) {
        notes.push('Approval history could not be loaded, so only well-known marketplaces were checked.');
      }
      if (result.failedChains.length) {
        notes.push(`Could not check: ${result.failedChains.map((id) => CHAINS[id as ChainId].name).join(', ')}.`);
      }
      setScanNote(notes.join(' ') || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval scan failed.');
    } finally {
      setScanning(false);
    }
  }, [session]);

  useEffect(() => {
    void scan();
  }, [scan]);

  if (!session) {
    return null;
  }

  const revoke = async () => {
    if (!revoking) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const wallet = await connectedWallet(session.mnemonic, revoking.asset.chainId as ChainId);
      const tx = await wallet.sendTransaction({ to: revoking.asset.address, data: revokeCalldata(revoking) });
      setRevoking(null);
      setScanNote(`Revoke sent: ${tx.hash}. Pull to refresh after it confirms.`);
    } catch (err) {
      setError(friendlyTxError(err, { fallback: 'Revoke failed.' }));
      setRevoking(null);
    } finally {
      setBusy(false);
    }
  };

  const nftAssets = PROTECTED_ASSETS;

  return (
    <Screen title="Protected collections" subtitle="Yuga Labs · BAYC · ApeCoin · Yaper" refreshing={scanning} onRefresh={() => void scan()}>
      <WarningBanner
        title="Your apes are locked down"
        lines={[
          'Approvals for these collections are blocked for every site and spender.',
          'Allowing one turns itself off after 10 minutes.',
          'Every send, approval, listing or permit needs your PIN or biometrics again, even when the wallet is unlocked.',
        ]}
      />
      {error ? <ErrorBanner message={error} /> : null}

      <Text style={styles.section}>Live approvals (on-chain)</Text>
      <View style={styles.card}>
        {scanning ? <Text style={styles.help}>Checking approvals on-chain…</Text> : null}
        {approvals && approvals.length === 0 && !scanning ? (
          <Text style={styles.help}>No live approvals on protected collections. Nothing can take your apes.</Text>
        ) : null}
        {(approvals ?? []).map((item) => (
          <View key={`${item.asset.key}-${item.spender}`} style={styles.row}>
            <View style={styles.copy}>
              <Text style={styles.label}>{`${item.asset.name} · ${CHAINS[item.asset.chainId as ChainId].name}`}</Text>
              <Text style={styles.help}>
                {item.kind === 'operator' ? 'Can take ALL items: ' : 'Can spend your APE: '}
                {item.spenderLabel}
              </Text>
              <Text selectable style={styles.mono}>
                {item.spender}
              </Text>
            </View>
            <Button label="Revoke" variant="danger" onPress={() => setRevoking(item)} />
          </View>
        ))}
        {scanNote ? <Text style={styles.help}>{scanNote}</Text> : null}
        <Button label="Check again" variant="secondary" loading={scanning} onPress={() => void scan()} />
        <Text style={styles.help}>
          Checks OpenSea, Seaport, Blur, LooksRare, X2Y2 and Permit2, plus every spender in this wallet's Ethereum approval history.
        </Text>
      </View>

      <Text style={styles.section}>Allow approvals (10 minutes)</Text>
      <View style={styles.card}>
        {nftAssets.map((asset) => {
          const left = approvalWindowRemainingMs(policy, asset.key, now);
          return (
            <View key={asset.key} style={styles.row}>
              <View style={styles.copy}>
                <Text style={styles.label}>{`${asset.name}${asset.chainId !== 1 ? ` · ${CHAINS[asset.chainId as ChainId].name}` : ''}`}</Text>
                <Text style={left > 0 ? styles.on : styles.help}>
                  {left > 0 ? `Approvals allowed · turns off in ${minutesLeft(left)}` : 'Approvals blocked'}
                </Text>
              </View>
              {left > 0 ? (
                <Button label="Turn off" variant="secondary" onPress={() => void save(closeApprovalWindow(policy, asset.key))} />
              ) : (
                <Button label="Allow" variant="ghost" onPress={() => setPendingAllow(asset)} />
              )}
            </View>
          );
        })}
      </View>

      <Text style={styles.section}>Sending protected NFTs</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.copy}>
            <Text style={styles.label}>Address book only</Text>
            <Text style={styles.help}>When on, protected NFTs can only go to addresses saved below.</Text>
          </View>
          <Switch
            value={policy.addressBookOnly}
            onValueChange={(value) => void save({ ...policy, addressBookOnly: value })}
            trackColor={{ true: colors.accentDim, false: colors.border }}
            thumbColor={policy.addressBookOnly ? colors.accent : colors.muted}
          />
        </View>
        {policy.addressBook.map((entry) => (
          <View key={entry.address} style={styles.row}>
            <View style={styles.copy}>
              <Text style={styles.label}>{entry.label || 'Saved address'}</Text>
              <Text selectable style={styles.mono}>
                {entry.address}
              </Text>
            </View>
            <Button label="Remove" variant="ghost" onPress={() => void save(removeAddressBookEntry(policy, entry.address))} />
          </View>
        ))}
        <TextInput
          value={newAddress}
          onChangeText={setNewAddress}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="0x… address to trust"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <TextInput
          value={newLabel}
          onChangeText={setNewLabel}
          placeholder="Label (e.g. My cold wallet)"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <Button
          label="Save address"
          variant="secondary"
          disabled={!isAddress(newAddress.trim())}
          onPress={() => {
            void save(addAddressBookEntry(policy, newAddress.trim(), newLabel));
            setNewAddress('');
            setNewLabel('');
          }}
        />
      </View>

      <Modal transparent animationType="fade" visible={Boolean(pendingAllow)} onRequestClose={() => setPendingAllow(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.label}>{`Allow approvals for ${pendingAllow?.name ?? ''}?`}</Text>
            <WarningBanner
              danger
              lines={[
                'Only do this if you are about to list or stake on a site you trust and you started it yourself.',
                'Each approval still shows the red warning and needs your PIN.',
                'This turns itself off after 10 minutes.',
              ]}
            />
            <ProtectedReauth
              reason="Allow approvals"
              confirmLabel="Allow"
              onVerified={() => {
                if (pendingAllow) {
                  void save(openApprovalWindow(policy, pendingAllow.key));
                }
                setPendingAllow(null);
              }}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setPendingAllow(null)} />
          </View>
        </View>
      </Modal>

      <ConfirmSheet
        visible={Boolean(revoking)}
        title="Revoke approval"
        network={revoking ? CHAINS[revoking.asset.chainId as ChainId].name : ''}
        from={session.address}
        to={revoking?.asset.address}
        amount={revoking ? `Remove ${revoking.spenderLabel} from ${revoking.asset.name}` : undefined}
        fee="Network gas (quoted at broadcast)"
        extra={revoking ? [{ label: 'Spender', value: revoking.spender }] : []}
        warnings={['Revoking only removes access. It cannot move your NFTs or tokens.']}
        loading={busy}
        confirmLabel="Hold to revoke"
        onConfirm={() => void revoke()}
        onCancel={() => setRevoking(null)}
      />
    </Screen>
  );
}
