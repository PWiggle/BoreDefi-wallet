import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { getAddress, isAddress } from 'ethers';

import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useProtectedGate } from '../components/useProtectedGate';
import { useLedger } from '../context/LedgerContext';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { addressWarnings, checksumAddress } from '../wallet/address-safety';
import { formatNative, formatTokenAmount, parseTokenAmount } from '../wallet/format';
import { checkPreflight, estimateFeeWei, GAS_UNITS, preflightLine } from '../wallet/preflight';
import { erc20TransferData, protectedTokenAsset, protectedTransferRequest } from '../wallet/protected-spend';
import {
  estimateContractCall,
  estimateNativeTransfer,
  fetchBalance,
  fetchMaxFeePerGas,
  sendContractCall,
  sendNativeTransfer,
} from '../wallet/rpc';
import { fetchTokenBalance } from '../wallet/swap';
import { tokensForChain, type TokenConfig } from '../wallet/tokens';
import { friendlyTxError } from '../wallet/tx-errors';
import { formatNetworkFee } from '../wallet/network-fee';
import { unexpectedProtectedMoves } from '../wallet/swap-preview';
import { previewInAppCalls } from '../wallet/tx-preview-runtime';
import type { TxPreview } from '../wallet/tx-simulate';
import { networkFeeLabel, useNetworkFee } from '../components/useNetworkFee';

function sendStyles({ colors, field, radius, spacing, type }: Theme) {
  return {
    label: type.label,
    input: field,
    meta: type.meta,
    hash: {
      ...type.meta,
      color: colors.text,
    },
    hint: { color: colors.text, fontWeight: '600' as const },
    tokenRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    token: {
      borderColor: colors.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    tokenOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
    tokenText: { color: colors.text, fontWeight: '700' as const },
    tokenTextOn: { color: colors.accent },
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
  const tokens = useMemo(() => tokensForChain(selectedChain.id), [selectedChain.id]);
  const [token, setToken] = useState<TokenConfig>(tokens[0]!);
  const [to, setTo] = useState(route.params?.to ?? '');
  const [amount, setAmount] = useState(route.params?.amount ?? '');
  const [nativeBalance, setNativeBalance] = useState<bigint>(0n);
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);
  const [balanceLoaded, setBalanceLoaded] = useState(false);
  const [maxFeePerGas, setMaxFeePerGas] = useState<bigint | null>(null);
  const [feeWei, setFeeWei] = useState<bigint | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const { gate: protectedGate, sheet: protectedSheet } = useProtectedGate(selectedChain.name);
  // Exact (token, to, amount) that passed the ApeCoin guard; confirm refuses anything else.
  const [clearedSend, setClearedSend] = useState<string | null>(null);
  // Transaction preview of the exact send, plus the expected fee in native + $.
  const [sendPreview, setSendPreview] = useState<TxPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [gasUnits, setGasUnits] = useState<bigint | null>(null);
  const networkFee = useNetworkFee(selectedChain.id, previewLoading ? null : (sendPreview?.gasUsed ?? gasUnits), review);

  useEffect(() => {
    if (route.params?.to) {
      setTo(route.params.to);
    }
    if (route.params?.amount) {
      setAmount(route.params.amount);
    }
  }, [route.params]);

  useEffect(() => {
    const hinted = route.params?.tokenSymbol
      ? tokens.find((item) => item.symbol.toLowerCase() === route.params?.tokenSymbol?.toLowerCase())
      : undefined;
    setToken(hinted ?? tokens[0]!);
  }, [route.params?.tokenSymbol, tokens]);

  useEffect(() => {
    if (!session) {
      return;
    }
    let live = true;
    setBalanceLoaded(false);
    setError(null);
    const spend = token.native ? Promise.resolve(null) : fetchTokenBalance(fromAddress, token, selectedChain.id);
    Promise.all([fetchBalance(fromAddress, selectedChain.id), spend])
      .then(([value, tokenValue]) => {
        if (!live) {
          return;
        }
        setNativeBalance(value);
        setTokenBalance(tokenValue ?? value);
        setBalanceLoaded(true);
      })
      .catch((err) => live && setError(friendlyTxError(err, { chainId: selectedChain.id, fallback: 'Could not load balance.' })));
    fetchMaxFeePerGas(selectedChain.id)
      .then((value) => live && setMaxFeePerGas(value))
      .catch(() => live && setMaxFeePerGas(null));
    return () => {
      live = false;
    };
  }, [fromAddress, selectedChain.id, session, token]);

  if (!session) {
    return null;
  }

  const symbol = token.native ? selectedChain.symbol : token.symbol;
  const protectedAsset = protectedTokenAsset(token);
  let typedUnits = 0n;
  try {
    typedUnits = amount.trim() ? parseTokenAmount(amount, token.decimals) : 0n;
  } catch {
    typedUnits = -1n;
  }
  const sendCheck = checkPreflight({
    chainId: selectedChain.id,
    amount: typedUnits,
    spendBalance: tokenBalance,
    spendSymbol: symbol,
    nativeBalance: balanceLoaded ? nativeBalance : null,
    feeWei:
      maxFeePerGas === null
        ? null
        : estimateFeeWei(selectedChain.id, token.native ? GAS_UNITS.nativeTransfer : GAS_UNITS.erc20Transfer, maxFeePerGas),
    spendIsNative: token.native,
  });
  const hint = preflightLine([sendCheck], amount.trim().length > 0);
  const sendKey = (recipient: string, units: bigint) => `${selectedChain.id}:${token.address}:${recipient.toLowerCase()}:${units}`;

  const prepare = async () => {
    setError(null);
    if (!isAddress(to)) {
      setError('Enter a valid recipient address.');
      return;
    }
    let units: bigint;
    try {
      units = parseTokenAmount(amount, token.decimals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid amount.');
      return;
    }
    if (units <= 0n) {
      setError('Amount must be greater than zero.');
      return;
    }
    const recipient = getAddress(to);
    try {
      const clipboard = await Clipboard.getStringAsync().catch(() => '');
      setWarnings(addressWarnings(to, clipboard));
      const estimate = token.native
        ? await estimateNativeTransfer(fromAddress, recipient, units, selectedChain.id)
        : await estimateContractCall(fromAddress, token.address, erc20TransferData(recipient, units), selectedChain.id);
      const exact = checkPreflight({
        chainId: selectedChain.id,
        amount: units,
        spendBalance: tokenBalance,
        spendSymbol: symbol,
        nativeBalance,
        feeWei: estimate.feeWei,
        spendIsNative: token.native,
      });
      if (!exact.ok) {
        setError(exact.message);
        return;
      }
      if (protectedAsset) {
        const ok = await protectedGate(protectedTransferRequest(token, fromAddress, recipient, units));
        if (!ok) {
          setClearedSend(null);
          setError(`${protectedAsset.name} is protected. The send was not approved, so nothing left this wallet.`);
          return;
        }
        setClearedSend(sendKey(recipient, units));
      }
      setFeeWei(estimate.feeWei);
      setGasUnits(estimate.gasLimit);
      setSendPreview(null);
      setPreviewLoading(true);
      setReview(true);
      const { preview, simulation } = await previewInAppCalls(selectedChain.id, fromAddress, [
        token.native
          ? { from: fromAddress, to: recipient, value: units, data: null }
          : { from: fromAddress, to: token.address, value: 0n, data: erc20TransferData(recipient, units) },
      ]);
      const unexpected = unexpectedProtectedMoves(selectedChain.id, simulation, fromAddress, new Set(protectedAsset ? [protectedAsset.key] : []));
      setPreviewLoading(false);
      if (unexpected.length) {
        setReview(false);
        setError(`Blocked: the preview shows this would also move your ${unexpected.map((item) => item.name).join(', ')}. Nothing was sent.`);
        return;
      }
      setSendPreview(preview);
    } catch (err) {
      setPreviewLoading(false);
      setError(friendlyTxError(err, { chainId: selectedChain.id, fallback: 'Could not estimate the network fee.' }));
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const recipient = getAddress(to);
      const units = parseTokenAmount(amount, token.decimals);
      if (protectedAsset && clearedSend !== sendKey(recipient, units)) {
        throw new Error(`${protectedAsset.name} is protected. Review the send again to confirm it.`);
      }
      const data = token.native ? undefined : erc20TransferData(recipient, units);
      const hash = ledger.account
        ? await ledger.signAndSend({
            to: token.native ? recipient : token.address,
            value: token.native ? units : 0n,
            data,
            chainId: selectedChain.id,
          })
        : token.native
          ? (await sendNativeTransfer(session.mnemonic, recipient, units, selectedChain.id)).hash
          : (await sendContractCall(session.mnemonic, token.address, data!, selectedChain.id)).hash;
      setReview(false);
      setClearedSend(null);
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
      title={`Send ${symbol}`}
      subtitle={ledger.account ? `Ledger ${fromAddress}` : selectedChain.name}
    >
      <ErrorBanner message={error} />
      <Text style={styles.label}>Token</Text>
      <View style={styles.tokenRow}>
        {tokens.map((item) => {
          const on = item.address === token.address;
          return (
            <Pressable
              key={item.address}
              onPress={() => {
                setToken(item);
                setReview(false);
                setClearedSend(null);
              }}
              style={[styles.token, on && styles.tokenOn]}
            >
              <Text style={[styles.tokenText, on && styles.tokenTextOn]}>{item.symbol}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.label}>To</Text>
      <TextInput
        value={to}
        onChangeText={(value) => {
          setTo(value);
          setClearedSend(null);
        }}
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
      <Text style={styles.label}>Amount ({symbol})</Text>
      <TextInput
        value={amount}
        onChangeText={(value) => {
          setAmount(value);
          setClearedSend(null);
        }}
        keyboardType="decimal-pad"
        style={styles.input}
        placeholder="0.0"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.meta}>
        Balance: {token.native ? formatNative(tokenBalance) : formatTokenAmount(tokenBalance, token.decimals)} {symbol}
      </Text>
      {protectedAsset ? (
        <Text style={styles.hint}>{protectedAsset.name} is Yuga-protected: sending needs the typed name and your PIN.</Text>
      ) : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <Button label="Review" onPress={prepare} disabled={!sendCheck.ok} />
      {protectedSheet}
      <ConfirmSheet
        visible={review}
        title="Confirm send"
        network={selectedChain.name}
        from={fromAddress}
        to={checksumAddress(to) ?? to}
        amount={`${amount} ${symbol}`}
        fee={previewLoading ? 'Estimating…' : networkFeeLabel(networkFee, feeWei !== null ? `up to ${formatNative(feeWei)} ${selectedChain.symbol}` : '—', formatNetworkFee)}
        preview={sendPreview}
        previewLoading={previewLoading}
        extra={token.native ? undefined : [{ label: 'Token contract', value: token.address }]}
        warnings={warnings}
        loading={busy || previewLoading}
        onConfirm={confirm}
        onCancel={() => setReview(false)}
      />
    </Screen>
  );
}
