import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getAddress, isAddress } from 'ethers';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useLedger } from '../context/LedgerContext';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { colors, radius, spacing } from '../theme';
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
        <Button label="Done" onPress={() => navigation.navigate('Home')} />
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
        editable={!review}
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
        editable={!review}
      />
      <Text style={styles.meta}>Balance: {formatNative(balance)} {selectedChain.symbol}</Text>
      {review ? (
        <View style={styles.review}>
          <Text style={styles.reviewTitle}>Confirm</Text>
          <Text style={styles.meta}>To {getAddress(to)}</Text>
          <Text style={styles.meta}>
            Amount {amount} {selectedChain.symbol}
          </Text>
          <Text style={styles.meta}>
            Network fee ≈ {feeWei !== null ? formatNative(feeWei) : '—'} {selectedChain.symbol}
          </Text>
          <Button label="Confirm and send" loading={busy} onPress={confirm} />
          <Button label="Edit" variant="ghost" onPress={() => setReview(false)} />
        </View>
      ) : (
        <Button label="Review" onPress={prepare} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.muted,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: spacing.md,
    minHeight: 52,
    fontSize: 16,
  },
  meta: {
    color: colors.muted,
  },
  review: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 18,
  },
  hash: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
  },
});
