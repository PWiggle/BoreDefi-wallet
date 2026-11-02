import { useEffect, useMemo, useReducer, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';

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
import type { MainStackParamList } from '../navigation';
import { formatTokenAmount, parseTokenAmount } from '../wallet/format';
import {
  ensureSpendAllowance,
  fetchSwapQuote,
  loadSpendBalance,
  sendSwapTransaction,
  SWAP_STEPS,
  type SwapQuote,
} from '../wallet/swap';
import { tokensForChain, type TokenConfig } from '../wallet/tokens';
import { checkPreflight, estimateFeeWei, GAS_UNITS, preflightLine } from '../wallet/preflight';
import { fetchBalance, fetchMaxFeePerGas } from '../wallet/rpc';
import { friendlyTxError } from '../wallet/tx-errors';
import { protectedApproveRequest, protectedTokenAsset } from '../wallet/protected-spend';
import { fetchUsdPrices, geckoIdForToken } from '../wallet/markets';
import { balanceKeyFor, initialSpendView, spendBanner, spendViewReducer } from '../wallet/spend-view';
import { canReviewSwap, checkSwapPrice, swapBalanceGate, swapQuoteKey, type PriceCheck } from '../wallet/swap-guard';

function swapStyles({ colors, card, chip, field, spacing }: Theme) {
  return {
    label: {
      color: colors.muted,
      fontWeight: '700' as const,
    },
    input: field,
    meta: {
      color: colors.muted,
    },
    tokenRow: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: spacing.sm,
    },
    token: chip,
    tokenOn: {
      borderColor: colors.accent,
      backgroundColor: colors.accentDim,
    },
    tokenText: {
      color: colors.muted,
      fontWeight: '700' as const,
    },
    tokenTextOn: {
      color: colors.accent,
    },
    hint: { color: colors.text, fontWeight: '600' as const },
    quote: {
      ...card,
      gap: spacing.sm,
    },
    quoteTitle: {
      color: colors.text,
      fontWeight: '700' as const,
      fontSize: 16,
    },
  };
}

export function SwapScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(swapStyles);
  const route = useRoute<RouteProp<MainStackParamList, 'Swap'>>();
  const { session, selectedChain, setSelectedChain } = useWallet();
  const ledger = useLedger();
  const fromAddress = ledger.account?.address ?? session?.address ?? '';
  const tokens = useMemo(() => tokensForChain(selectedChain.id), [selectedChain.id]);
  const [fromToken, setFromToken] = useState<TokenConfig>(tokens[0]!);
  const [toToken, setToToken] = useState<TokenConfig>(tokens[1] ?? tokens[0]!);
  const [amount, setAmount] = useState('');
  const [nativeBalance, setNativeBalance] = useState<bigint | null>(null);
  const [maxFeePerGas, setMaxFeePerGas] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteKey, setQuoteKey] = useState<string | null>(null);
  const [priceCheck, setPriceCheck] = useState<PriceCheck | null>(null);
  // Banner + balance rules live in spend-view.ts (tested): errors clear on chain/token change, a balance is only
  // used for the chain + token it was read for, a later successful read clears the balance error.
  const errorKey = `${selectedChain.id}:${fromToken.address}:${toToken.address}`;
  const balanceKey = balanceKeyFor(selectedChain.id, fromToken.address);
  const [view, dispatch] = useReducer(spendViewReducer, undefined, () => initialSpendView(errorKey, balanceKey));
  const { balance, balanceError, error } = view;
  const setError = (message: string | null) => dispatch({ type: 'error', message });
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const { gate: protectedGate, sheet: protectedSheet } = useProtectedGate(selectedChain.name);
  // Quote key that passed the ApeCoin (Yuga-protected) guard; confirm refuses any other quote.
  const [clearedKey, setClearedKey] = useState<string | null>(null);

  useEffect(() => {
    const next = tokensForChain(selectedChain.id);
    setFromToken(next[0]!);
    const hinted = route.params?.fromSymbol
      ? next.find((token) => token.symbol.toLowerCase() === route.params.fromSymbol?.toLowerCase())
      : undefined;
    setFromToken(hinted ?? next[0]!);
    setToToken(next.find((token) => token.address !== (hinted ?? next[0]!).address) ?? next[1] ?? next[0]!);
    setQuote(null);
    setQuoteKey(null);
    setPriceCheck(null);
    setTxHash(null);
  }, [route.params?.fromSymbol, selectedChain.id]);

  // Any change to the pair invalidates the quote (build 4 kept an ETH→WETH quote after switching to USDT).
  useEffect(() => {
    setQuote(null);
    setQuoteKey(null);
    setPriceCheck(null);
  }, [fromToken.address, toToken.address]);

  // Must stay before the balance effect: a chain/token change clears the banner and the old balance first.
  useEffect(() => {
    dispatch({ type: 'context', errorKey, balanceKey });
  }, [errorKey, balanceKey]);

  useEffect(() => {
    if (toToken.address === fromToken.address) {
      const next = tokens.find((token) => token.address !== fromToken.address);
      if (next) {
        setToToken(next);
      }
    }
  }, [fromToken.address, toToken.address, tokens]);

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

  if (!session) {
    return null;
  }

  let typedUnits = 0n;
  try {
    typedUnits = amount.trim() ? parseTokenAmount(amount, fromToken.decimals) : 0n;
  } catch {
    typedUnits = -1n;
  }
  const swapGasUnits =
    (quote?.transactionRequest.gasLimit ?? GAS_UNITS.swap) + (fromToken.native ? 0n : GAS_UNITS.erc20Approve);
  const swapCheck = swapBalanceGate(balance, balanceError) ?? checkPreflight({
    chainId: selectedChain.id,
    amount: typedUnits,
    spendBalance: balance ?? 0n,
    spendSymbol: fromToken.symbol,
    nativeBalance,
    feeWei: maxFeePerGas === null ? null : estimateFeeWei(selectedChain.id, swapGasUnits, maxFeePerGas),
    spendIsNative: fromToken.native,
  });
  const hint = preflightLine([swapCheck], amount.trim().length > 0);
  const currentKey = swapQuoteKey(selectedChain.id, fromToken, toToken, typedUnits);
  const quoteIsCurrent = quote !== null && quoteKey === currentKey;
  const reviewEnabled = canReviewSwap({
    quoteKey,
    currentKey,
    preflightOk: swapCheck.ok,
    priceOk: priceCheck?.ok === true,
    busy,
  });

  const quoteSwap = async () => {
    setError(null);
    setBusy(true);
    setPriceCheck(null);
    try {
      const fromAmount = parseTokenAmount(amount, fromToken.decimals);
      const requestedKey = swapQuoteKey(selectedChain.id, fromToken, toToken, fromAmount);
      const next = await fetchSwapQuote({
        chainId: selectedChain.id,
        fromToken,
        toToken,
        fromAmount,
        fromAddress,
      });
      const ids = [geckoIdForToken(fromToken), geckoIdForToken(toToken)];
      const prices = await fetchUsdPrices(ids.filter((id): id is string => Boolean(id))).catch(() => ({}) as Record<string, number>);
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
        friendlyTxError(err, { chainId: selectedChain.id, step: SWAP_STEPS.quote, fallback: 'No route available' }),
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
        setError(`${protectedFrom.name} is protected. The swap was not approved, so nothing was sent.`);
        return;
      }
      setClearedKey(quoteKey);
    }
    setReview(true);
  };

  const confirm = async () => {
    if (protectedFrom && (clearedKey === null || clearedKey !== quoteKey)) {
      setReview(false);
      setError(`${protectedFrom.name} is protected. Review the swap again to confirm it.`);
      return;
    }
    if (!quote || !reviewEnabled) {
      setReview(false);
      return;
    }
    if (!swapCheck.ok) {
      setReview(false);
      setError(swapCheck.message);
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
      // No step here on purpose: a timed-out broadcast may have gone through, so keep "Check Activity first".
      setError(friendlyTxError(err, { chainId: selectedChain.id, fallback: 'Swap failed. Nothing was swapped.' }));
    } finally {
      setBusy(false);
    }
  };

  if (txHash) {
    return (
      <Screen title="Swap submitted" subtitle={selectedChain.name}>
        <Text style={styles.meta}>{txHash}</Text>
        <Button label="New swap" onPress={() => { setTxHash(null); setQuote(null); setQuoteKey(null); setPriceCheck(null); setAmount(''); }} />
      </Screen>
    );
  }

  return (
    <Screen title="Swap" subtitle="Best same-chain route via LI.FI (aggregates 1inch, 0x, Kyber, and others).">
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      <ErrorBanner message={spendBanner(view)} />
      <Text style={styles.label}>From</Text>
      <TokenRow tokens={tokens} selected={fromToken} onSelect={setFromToken} />
      <TextInput
        value={amount}
        onChangeText={(value) => { setAmount(value); setQuote(null); setQuoteKey(null); setPriceCheck(null); }}
        keyboardType="decimal-pad"
        style={styles.input}
        placeholder="0.0"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.meta}>
        Balance {balance === null ? '…' : formatTokenAmount(balance, fromToken.decimals)} {fromToken.symbol}
      </Text>
      <Text style={styles.label}>To</Text>
      <TokenRow tokens={tokens.filter((token) => token.address !== fromToken.address)} selected={toToken} onSelect={setToToken} />
      {quote && quoteIsCurrent ? (
        <View style={styles.quote}>
          <Text style={styles.quoteTitle}>Best route · {quote.toolName}</Text>
          <Text style={styles.meta}>
            You receive ≈ {formatTokenAmount(quote.toAmount, quote.toToken.decimals)} {quote.toToken.symbol}
          </Text>
          <Text style={styles.meta}>
            Minimum {formatTokenAmount(quote.toAmountMin, quote.toToken.decimals)} {quote.toToken.symbol}
          </Text>
          {priceCheck && !priceCheck.ok ? (
            <WarningBanner title="Price check failed" lines={[priceCheck.message]} danger />
          ) : null}
          <Button label="Review swap" loading={busy} onPress={openReview} disabled={!reviewEnabled} />
        </View>
      ) : (
        <Button label="Get best quote" loading={busy} onPress={quoteSwap} disabled={!swapCheck.ok} />
      )}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {protectedSheet}
      <ConfirmSheet
        visible={review && Boolean(quote) && reviewEnabled}
        title="Confirm swap"
        network={selectedChain.name}
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

function TokenRow({
  tokens,
  selected,
  onSelect,
}: {
  tokens: TokenConfig[];
  selected: TokenConfig;
  onSelect: (token: TokenConfig) => void;
}) {
  const styles = useThemedStyles(swapStyles);
  return (
    <View style={styles.tokenRow}>
      {tokens.map((token) => (
        <Pressable
          key={token.address}
          onPress={() => onSelect(token)}
          style={[styles.token, selected.address === token.address && styles.tokenOn]}
        >
          <Text style={[styles.tokenText, selected.address === token.address && styles.tokenTextOn]}>
            {token.symbol}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
