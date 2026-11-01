import { useEffect, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { getAddress, isAddress } from 'ethers';

import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useLedger } from '../context/LedgerContext';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { addressWarnings, checksumAddress } from '../wallet/address-safety';
import { formatNative, parseAmountToWei } from '../wallet/format';
import { checkPreflight, estimateFeeWei, GAS_UNITS, preflightLine } from '../wallet/preflight';
import { estimateNativeTransfer, fetchBalance, fetchMaxFeePerGas, sendNativeTransfer } from '../wallet/rpc';
import { friendlyTxError } from '../wallet/tx-errors';

function sendStyles({ colors, field, type }: Theme) {
  return {
    label: type.label,
    input: field,
    meta: type.meta,
    hash: {
      ...type.meta,
      color: colors.text,
    },
    hint: { color: colors.text, fontWeight: '600' as const },
  };
}

export function SendScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(sendStyles);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'Send'>>();
  const { session, selectedChain } = useWallet();
  const ledger = useLedger();
  const fromAddress = ledger.account?.address ?? session?.address ?? '';
  const [to, setTo] = useState(route.params?.to ?? '');
  const [amount, setAmount] = useState(route.params?.amount ?? '');
  const [balance, setBalance] = useState<bigint>(0n);
  const [balanceLoaded, setBalanceLoaded] = useState(false);
  const [maxFeePerGas, setMaxFeePerGas] = useState<bigint | null>(null);
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
    setBalanceLoaded(false);
    fetchBalance(fromAddress, selectedChain.id)
      .then((value) => {
        setBalance(value);
        setBalanceLoaded(true);
      })
      .catch((err) => setError(friendlyTxError(err, { chainId: selectedChain.id, fallback: 'Could not load balance.' })));
    fetchMaxFeePerGas(selectedChain.id)
      .then(setMaxFeePerGas)
      .catch(() => setMaxFeePerGas(null));
  }, [fromAddress, selectedChain.id, session]);

  if (!session) {
    return null;
  }

  let typedWei = 0n;
  try {
    typedWei = amount.trim() ? parseAmountToWei(amount) : 0n;
  } catch {
    typedWei = -1n;
  }
  const sendCheck = checkPreflight({
    chainId: selectedChain.id,
    amount: typedWei,
    spendBalance: balance,
    spendSymbol: selectedChain.symbol,
    nativeBalance: balanceLoaded ? balance : null,
    feeWei: maxFeePerGas === null ? null : estimateFeeWei(selectedChain.id, GAS_UNITS.nativeTransfer, maxFeePerGas),
    spendIsNative: true,
  });
  const hint = preflightLine([sendCheck], amount.trim().length > 0);

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
      const exact = checkPreflight({
        chainId: selectedChain.id,
        amount: amountWei,
        spendBalance: balance,
        spendSymbol: selectedChain.symbol,
        nativeBalance: balance,
        feeWei: estimate.feeWei,
        spendIsNative: true,
      });
      if (!exact.ok) {
        setError(exact.message);
        return;
      }
      setFeeWei(estimate.feeWei);
      setReview(true);
    } catch (err) {
      setError(friendlyTxError(err, { chainId: selectedChain.id, fallback: 'Could not estimate the network fee.' }));
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
      setError(friendlyTxError(err, { chainId: selectedChain.id, fallback: 'Send failed. Nothing left this wallet.' }));
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
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <Button label="Review" onPress={prepare} disabled={!sendCheck.ok} />
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
