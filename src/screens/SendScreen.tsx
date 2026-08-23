import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { getAddress, isAddress } from 'ethers';

import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useLedger } from '../context/LedgerContext';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { colors, field, type } from '../theme';
import { addressWarnings, checksumAddress } from '../wallet/address-safety';
import { formatNative, parseAmountToWei } from '../wallet/format';
import { estimateNativeTransfer, fetchBalance, sendNativeTransfer } from '../wallet/rpc';

export function SendScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'Send'>>();
  const { session, selectedChain } = useWallet();
  const ledger = useLedger();
  const fromAddress = ledger.account?.address ?? session?.address ?? '';
  const [to, setTo] = useState(route.params?.to ?? '');
  const [amount, setAmount] = useState(route.params?.amount ?? '');
  const [balance, setBalance] = useState<bigint>(0n);
  const [feeWei, setFeeWei] = useState<bigint | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    if (route.params?.to) {
      setTo(route.params.to);
    }
    if (route.params?.amount) {
      setAmount(route.params.amount);
    }
  }, [route.params]);

  useEffect(() => {
    if (!session) {
      return;
    }
    fetchBalance(fromAddress, selectedChain.id)
      .then(setBalance)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load balance.'));
  }, [fromAddress, selectedChain.id, session]);

  if (!session) {
    return null;
  }

  const prepare = async () => {
    setError(null);
    if (!isAddress(to)) {
      setError('Enter a valid recipient address.');
      return;
    }
    let amountWei: bigint;
    try {
      amountWei = parseAmountToWei(amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid amount.');
      return;
    }
    if (amountWei <= 0n) {
      setError('Amount must be greater than zero.');
      return;
    }
    try {
      const clipboard = await Clipboard.getStringAsync().catch(() => '');
      setWarnings(addressWarnings(to, clipboard));
      const estimate = await estimateNativeTransfer(
        fromAddress,
        getAddress(to),
        amountWei,
        selectedChain.id,
      );
      if (amountWei + estimate.feeWei > balance) {
        setError('Insufficient balance to cover amount plus network fee.');
        return;
      }
      setFeeWei(estimate.feeWei);
      setReview(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not estimate fee.');
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const hash = ledger.account
        ? await ledger.signAndSend({
            to: getAddress(to),
            value: parseAmountToWei(amount),
            chainId: selectedChain.id,
          })
        : (
            await sendNativeTransfer(
              session.mnemonic,
              getAddress(to),
              parseAmountToWei(amount),
              selectedChain.id,
            )
          ).hash;
      setReview(false);
      setTxHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed.');
      setReview(false);
    } finally {
      setBusy(false);
    }
  };

  if (txHash) {
    return (
      <Screen title="Sent" subtitle={selectedChain.name}>
        <Text style={styles.hash}>{txHash}</Text>
        <Button label="Done" onPress={() => navigation.navigate('Tabs', { screen: 'Wallet' })} />
      </Screen>
    );
  }

  return (
    <Screen
      title={`Send ${selectedChain.symbol}`}
      subtitle={ledger.account ? `Ledger ${fromAddress}` : selectedChain.name}
    >
      <ErrorBanner message={error} />
      <Text style={styles.label}>To</Text>
      <TextInput
        value={to}
        onChangeText={setTo}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholder="0x…"
        placeholderTextColor={colors.muted}
      />
      <Button
        label="Scan QR"
        variant="secondary"
        onPress={() => navigation.navigate('ScanQr', { purpose: 'payment' })}
      />
      <Text style={styles.label}>Amount ({selectedChain.symbol})</Text>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        style={styles.input}
        placeholder="0.0"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.meta}>Balance: {formatNative(balance)} {selectedChain.symbol}</Text>
      <Button label="Review" onPress={prepare} />
      <ConfirmSheet
        visible={review}
        title="Confirm send"
        network={selectedChain.name}
        from={fromAddress}
        to={checksumAddress(to) ?? to}
        amount={`${amount} ${selectedChain.symbol}`}
        fee={feeWei !== null ? `${formatNative(feeWei)} ${selectedChain.symbol}` : '—'}
        warnings={warnings}
        loading={busy}
        onConfirm={confirm}
        onCancel={() => setReview(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: type.label,
  input: field,
  meta: type.meta,
  hash: {
    ...type.meta,
    color: colors.text,
  },
});
