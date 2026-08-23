import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';

import { Button } from '../components/Button';
import { ChainPicker } from '../components/ChainPicker';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useLedger } from '../context/LedgerContext';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { card, chip, colors, field, spacing } from '../theme';
import { formatTokenAmount, parseTokenAmount } from '../wallet/format';
import {
  ensureSpendAllowance,
  fetchSwapQuote,
  fetchTokenBalance,
  sendSwapTransaction,
  type SwapQuote,
} from '../wallet/swap';
import { tokensForChain, type TokenConfig } from '../wallet/tokens';

export function SwapScreen() {
  const route = useRoute<RouteProp<MainStackParamList, 'Swap'>>();
  const { session, selectedChain, setSelectedChain } = useWallet();
  const ledger = useLedger();
  const fromAddress = ledger.account?.address ?? session?.address ?? '';
  const tokens = useMemo(() => tokensForChain(selectedChain.id), [selectedChain.id]);
  const [fromToken, setFromToken] = useState<TokenConfig>(tokens[0]!);
  const [toToken, setToToken] = useState<TokenConfig>(tokens[1] ?? tokens[0]!);
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState<bigint>(0n);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    const next = tokensForChain(selectedChain.id);
    setFromToken(next[0]!);
    const hinted = route.params?.fromSymbol
      ? next.find((token) => token.symbol.toLowerCase() === route.params.fromSymbol?.toLowerCase())
      : undefined;
    setFromToken(hinted ?? next[0]!);
    setToToken(next.find((token) => token.address !== (hinted ?? next[0]!).address) ?? next[1] ?? next[0]!);
    setQuote(null);
    setTxHash(null);
  }, [route.params?.fromSymbol, selectedChain.id]);

  useEffect(() => {
    if (!session) {
      return;
    }
    fetchTokenBalance(fromAddress, fromToken, selectedChain.id)
      .then(setBalance)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load balance.'));
  }, [fromAddress, fromToken, selectedChain.id, session]);

  if (!session) {
    return null;
  }

  const quoteSwap = async () => {
    setError(null);
    setBusy(true);
    try {
      const fromAmount = parseTokenAmount(amount, fromToken.decimals);
      if (fromAmount > balance) {
        throw new Error('Amount is larger than the token balance.');
      }
      setQuote(
        await fetchSwapQuote({
          chainId: selectedChain.id,
          fromToken,
          toToken,
          fromAmount,
          fromAddress,
        }),
      );
    } catch (err) {
      setQuote(null);
      setError(err instanceof Error ? err.message : 'Quote failed.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!quote) {
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
      setTxHash(tx.hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Swap failed.');
    } finally {
      setBusy(false);
    }
  };

  if (txHash) {
    return (
      <Screen title="Swap submitted" subtitle={selectedChain.name}>
        <Text style={styles.meta}>{txHash}</Text>
        <Button label="New swap" onPress={() => { setTxHash(null); setQuote(null); setAmount(''); }} />
      </Screen>
    );
  }

  return (
    <Screen title="Swap" subtitle="Best same-chain route via LI.FI (aggregates 1inch, 0x, Kyber, and others).">
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      <ErrorBanner message={error} />
      <Text style={styles.label}>From</Text>
      <TokenRow tokens={tokens} selected={fromToken} onSelect={setFromToken} />
      <TextInput
        value={amount}
        onChangeText={(value) => { setAmount(value); setQuote(null); }}
        keyboardType="decimal-pad"
        style={styles.input}
        placeholder="0.0"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.meta}>
        Balance {formatTokenAmount(balance, fromToken.decimals)} {fromToken.symbol}
      </Text>
      <Text style={styles.label}>To</Text>
      <TokenRow tokens={tokens.filter((token) => token.address !== fromToken.address)} selected={toToken} onSelect={setToToken} />
      {quote ? (
        <View style={styles.quote}>
          <Text style={styles.quoteTitle}>Best route · {quote.toolName}</Text>
          <Text style={styles.meta}>
            You receive ≈ {formatTokenAmount(quote.toAmount, toToken.decimals)} {toToken.symbol}
          </Text>
          <Text style={styles.meta}>
            Minimum {formatTokenAmount(quote.toAmountMin, toToken.decimals)} {toToken.symbol}
          </Text>
          <Button label="Confirm swap" loading={busy} onPress={confirm} />
        </View>
      ) : (
        <Button label="Get best quote" loading={busy} onPress={quoteSwap} />
      )}
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

const styles = StyleSheet.create({
  label: {
    color: colors.muted,
    fontWeight: '700',
  },
  input: field,
  meta: {
    color: colors.muted,
  },
  tokenRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  token: chip,
  tokenOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  tokenText: {
    color: colors.muted,
    fontWeight: '700',
  },
  tokenTextOn: {
    color: colors.accent,
  },
  quote: {
    ...card,
    gap: spacing.sm,
  },
  quoteTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
});
