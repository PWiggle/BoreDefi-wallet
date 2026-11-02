import { useEffect, useMemo, useReducer, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { ChainPicker } from '../components/ChainPicker';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useProtectedGate } from '../components/useProtectedGate';
import { ErrorBanner } from '../components/ErrorBanner';
import { WarningBanner } from '../components/WarningBanner';
import { Screen } from '../components/Screen';
import { useLedger } from '../context/LedgerContext';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { CHAIN_LIST, type ChainId } from '../wallet/chains';
import { formatTokenAmount, parseTokenAmount } from '../wallet/format';
import {
  ensureSpendAllowance,
  fetchBridgeQuote,
  loadSpendBalance,
  sendSwapTransaction,
  SWAP_STEPS,
  type SwapQuote,
} from '../wallet/swap';
import { tokensForChain, type TokenConfig } from '../wallet/tokens';
import { friendlyTxError } from '../wallet/tx-errors';
import { protectedApproveRequest, protectedTokenAsset } from '../wallet/protected-spend';
import { fetchUsdPrices, geckoIdForToken } from '../wallet/markets';
import { checkPreflight, estimateFeeWei, GAS_UNITS, preflightLine } from '../wallet/preflight';
import { fetchBalance, fetchMaxFeePerGas } from '../wallet/rpc';
import { balanceKeyFor, initialSpendView, spendBanner, spendViewReducer } from '../wallet/spend-view';
import { bridgeQuoteKey, canReviewSwap, checkSwapPrice, swapBalanceGate, type PriceCheck } from '../wallet/swap-guard';

function otherChainId(current: ChainId): ChainId {
  return CHAIN_LIST.find((chain) => chain.id !== current)?.id ?? current;
}

function bridgeStyles({ colors, card, chip, field, spacing }: Theme) {
  return {
    copy: { color: colors.muted },
    label: { color: colors.text, fontWeight: '700' as const },
    row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    chip,
    chipOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
    chipText: { color: colors.text, fontWeight: '700' as const },
    input: field,
    meta: { color: colors.muted },
    box: {
      ...card,
      gap: spacing.sm,
    },
    boxTitle: { color: colors.text, fontWeight: '700' as const },
    hash: { color: colors.accent },
    hint: { color: colors.text, fontWeight: '600' as const },
  };
}

export function BridgeScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(bridgeStyles);
  const { session, selectedChain, setSelectedChain } = useWallet();
  const ledger = useLedger();
  const fromAddress = ledger.account?.address ?? session?.address ?? '';
  const [toChainId, setToChainId] = useState(otherChainId(selectedChain.id));
  const fromTokens = useMemo(() => tokensForChain(selectedChain.id), [selectedChain.id]);
  const toTokens = useMemo(() => tokensForChain(toChainId), [toChainId]);
  const [fromToken, setFromToken] = useState<TokenConfig>(fromTokens[0]!);
  const [toToken, setToToken] = useState<TokenConfig>(toTokens[0]!);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteKey, setQuoteKey] = useState<string | null>(null);
  const [priceCheck, setPriceCheck] = useState<PriceCheck | null>(null);
  const [nativeBalance, setNativeBalance] = useState<bigint | null>(null);
  const [maxFeePerGas, setMaxFeePerGas] = useState<bigint | null>(null);
  // Banner + balance rules live in spend-view.ts (tested): errors clear on chain/token change, a balance is only
  // used for the chain + token it was read for, a later successful read clears the balance error.
  const errorKey = `${selectedChain.id}>${toChainId}:${fromToken.address}:${toToken.address}`;
  const balanceKey = balanceKeyFor(selectedChain.id, fromToken.address);
  const [view, dispatch] = useReducer(spendViewReducer, undefined, () => initialSpendView(errorKey, balanceKey));
  const { balance, balanceError, error } = view;
  const setError = (message: string | null) => dispatch({ type: 'error', message });
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const { gate: protectedGate, sheet: protectedSheet } = useProtectedGate(selectedChain.name);
  // Quote key that passed the ApeCoin (Yuga-protected) guard; confirm refuses any other quote.
  const [clearedKey, setClearedKey] = useState<string | null>(null);

  useEffect(() => {
    const next = tokensForChain(selectedChain.id);
    setFromToken(next[0]!);
    if (toChainId === selectedChain.id) {
      setToChainId(otherChainId(selectedChain.id));
    }
    setTxHash(null);
  }, [selectedChain.id]);

  useEffect(() => {
    setToToken(tokensForChain(toChainId)[0]!);
  }, [toChainId]);

  // Any change to chains, tokens or amount makes the old quote unusable.
  useEffect(() => {
    setQuote(null);
    setQuoteKey(null);
    setPriceCheck(null);
    setReview(false);
  }, [selectedChain.id, toChainId, fromToken.address, toToken.address, amount]);

  // Must stay before the balance effect: a chain/token change clears the banner and the old balance first.
  useEffect(() => {
    dispatch({ type: 'context', errorKey, balanceKey });
  }, [errorKey, balanceKey]);

  useEffect(() => {
    if (!session) {
      return;
    }
    setNativeBalance(null);
    fetchBalance(fromAddress, selectedChain.id)
      .then(setNativeBalance)
      .catch(() => setNativeBalance(null));
    fetchMaxFeePerGas(selectedChain.id)
      .then(setMaxFeePerGas)
      .catch(() => setMaxFeePerGas(null));
  }, [fromAddress, selectedChain.id, session, txHash]);

  useEffect(() => {
    if (!session) {
      return;
    }
    const key = balanceKeyFor(selectedChain.id, fromToken.address);
    dispatch({ type: 'balance-loading', balanceKey: key });
    // The reducer drops a result whose key no longer matches (user switched chain/token meanwhile).
    loadSpendBalance(fromAddress, fromToken, selectedChain.id).then((result) =>
      dispatch({ type: 'balance', balanceKey: key, result }),
    );
  }, [fromAddress, fromToken, selectedChain.id, session, txHash]);

  if (!session) {
    return null;
  }

  let typedUnits = 0n;
  try {
    typedUnits = amount.trim() ? parseTokenAmount(amount, fromToken.decimals) : 0n;
  } catch {
    typedUnits = -1n;
  }
  const bridgeGasUnits =
    (quote?.transactionRequest.gasLimit ?? GAS_UNITS.bridge) + (fromToken.native ? 0n : GAS_UNITS.erc20Approve);
  const bridgeCheck = swapBalanceGate(balance, balanceError) ?? checkPreflight({
    chainId: selectedChain.id,
    amount: typedUnits,
    spendBalance: balance ?? 0n,
    spendSymbol: fromToken.symbol,
    nativeBalance,
    feeWei: maxFeePerGas === null ? null : estimateFeeWei(selectedChain.id, bridgeGasUnits, maxFeePerGas),
    spendIsNative: fromToken.native,
  });
  const hint = preflightLine([bridgeCheck], amount.trim().length > 0);
  const currentKey = bridgeQuoteKey(selectedChain.id, toChainId, fromToken, toToken, typedUnits);
  const quoteIsCurrent = quote !== null && quoteKey === currentKey;
  const reviewEnabled = canReviewSwap({
    quoteKey,
    currentKey,
    preflightOk: bridgeCheck.ok,
    priceOk: priceCheck?.ok === true,
    busy,
  });

  const quoteBridge = async () => {
    setBusy(true);
    setError(null);
    setPriceCheck(null);
    try {
      const fromAmount = parseTokenAmount(amount, fromToken.decimals);
      const requestedKey = bridgeQuoteKey(selectedChain.id, toChainId, fromToken, toToken, fromAmount);
      const next = await fetchBridgeQuote({
        fromChainId: selectedChain.id,
        toChainId,
        fromToken,
        toToken,
        fromAmount,
        fromAddress,
      });
      const ids = [geckoIdForToken(fromToken), geckoIdForToken(toToken)];
      const prices = await fetchUsdPrices(ids.filter((id): id is string => Boolean(id))).catch(
        () => ({}) as Record<string, number>,
      );
      setPriceCheck(
        checkSwapPrice({
          fromAmount: next.fromAmount,
          fromDecimals: next.fromToken.decimals,
          toAmount: next.toAmount,
          toDecimals: next.toToken.decimals,
          fromPriceUsd: ids[0] ? prices[ids[0]] ?? null : null,
          toPriceUsd: ids[1] ? prices[ids[1]] ?? null : null,
          aggregatorFromUsd: next.fromAmountUsd,
          aggregatorToUsd: next.toAmountUsd,
        }),
      );
      setQuote(next);
      setQuoteKey(requestedKey);
    } catch (err) {
      setQuote(null);
      setQuoteKey(null);
      setError(
        friendlyTxError(err, { chainId: selectedChain.id, step: SWAP_STEPS.bridgeQuote, fallback: 'No route available' }),
      );
    } finally {
      setBusy(false);
    }
  };

  const protectedFrom = protectedTokenAsset(fromToken);

  const openReview = async () => {
    if (!quote) {
      return;
    }
    if (protectedFrom) {
      const spender = quote.approvalAddress ?? quote.transactionRequest.to;
      if (!spender) {
        setError('This route has no spender to check. Nothing was sent.');
        return;
      }
      setError(null);
      const ok = await protectedGate(protectedApproveRequest(fromToken, fromAddress, spender, quote.fromAmount));
      if (!ok) {
        setClearedKey(null);
        setError(`${protectedFrom.name} is protected. The bridge was not approved, so nothing was sent.`);
        return;
      }
      setClearedKey(quoteKey);
    }
    setReview(true);
  };

  const confirm = async () => {
    if (protectedFrom && (clearedKey === null || clearedKey !== quoteKey)) {
      setReview(false);
      setError(`${protectedFrom.name} is protected. Review the bridge again to confirm it.`);
      return;
    }
    if (!quote || !reviewEnabled) {
      setReview(false);
      if (!bridgeCheck.ok) {
        setError(bridgeCheck.message);
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sendTx = ledger.account
        ? (tx: { to?: string; data?: string; value?: bigint; gasLimit?: bigint; chainId: number }) =>
            ledger.signAndSend({
              to: tx.to,
              data: tx.data,
              value: tx.value,
              gasLimit: tx.gasLimit,
              chainId: selectedChain.id,
            })
        : undefined;
      if (quote.approvalAddress) {
        await ensureSpendAllowance({
          mnemonic: session.mnemonic,
          token: fromToken,
          owner: fromAddress,
          spender: quote.approvalAddress,
          amount: quote.fromAmount,
          chainId: selectedChain.id,
          sendTx,
        });
      }
      const tx = await sendSwapTransaction(session.mnemonic, quote, selectedChain.id, sendTx);
      setReview(false);
      setTxHash(tx.hash);
    } catch (err) {
      setReview(false);
      setError(friendlyTxError(err, { chainId: selectedChain.id, fallback: 'Bridge failed. Nothing was sent.' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Bridge" subtitle="Cross-chain LI.FI routes (fromChain !== toChain).">
      <Text style={styles.copy}>
        Same-chain quotes stay on Swap. The signed transaction is sent on the source chain.
      </Text>
      {spendBanner(view) ? <ErrorBanner message={spendBanner(view)} /> : null}
      <Text style={styles.label}>From</Text>
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      <View style={styles.row}>
        {fromTokens.map((token) => (
          <Pressable
            key={token.address}
            onPress={() => setFromToken(token)}
            style={[styles.chip, fromToken.address === token.address && styles.chipOn]}
          >
            <Text style={styles.chipText}>{token.symbol}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>To</Text>
      <ChainPicker selected={toChainId} onSelect={setToChainId} />
      <View style={styles.row}>
        {toTokens.map((token) => (
          <Pressable
            key={token.address}
            onPress={() => setToToken(token)}
            style={[styles.chip, toToken.address === token.address && styles.chipOn]}
          >
            <Text style={styles.chipText}>{token.symbol}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder={`Amount (${fromToken.symbol})`}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Text style={styles.meta}>
        Balance {balance === null ? '…' : formatTokenAmount(balance, fromToken.decimals)} {fromToken.symbol}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <Button label="Get quote" onPress={quoteBridge} loading={busy} disabled={!bridgeCheck.ok} />
      {quote && quoteIsCurrent ? (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>
            Receive ≈ {formatTokenAmount(quote.toAmount, quote.toToken.decimals)} {quote.toToken.symbol} via{' '}
            {quote.toolName}
          </Text>
          <Text style={styles.meta}>
            Minimum {formatTokenAmount(quote.toAmountMin, quote.toToken.decimals)} {quote.toToken.symbol}
          </Text>
          {priceCheck && !priceCheck.ok ? (
            <WarningBanner title="Price check failed" lines={[priceCheck.message]} danger />
          ) : null}
          <Button label="Review bridge" onPress={openReview} loading={busy} disabled={!reviewEnabled} />
        </View>
      ) : null}
      {txHash ? <Text style={styles.hash}>Submitted {txHash}</Text> : null}
      {protectedSheet}
      <ConfirmSheet
        visible={review && Boolean(quote) && reviewEnabled}
        title="Confirm bridge"
        network={`${selectedChain.name} → ${CHAIN_LIST.find((chain) => chain.id === toChainId)?.name ?? toChainId}`}
        from={fromAddress}
        to={quote?.transactionRequest.to}
        amount={
          quote
            ? `${formatTokenAmount(quote.fromAmount, quote.fromToken.decimals)} ${quote.fromToken.symbol} → ${formatTokenAmount(quote.toAmount, quote.toToken.decimals)} ${quote.toToken.symbol}`
            : undefined
        }
        fee={
          quote?.transactionRequest.gasLimit
            ? `Gas limit ${quote.transactionRequest.gasLimit.toString()}`
            : 'Network gas (quoted at broadcast)'
        }
        extra={quote ? [{ label: 'Route', value: quote.toolName }] : []}
        loading={busy}
        onConfirm={confirm}
        onCancel={() => setReview(false)}
      />
    </Screen>
  );
}
