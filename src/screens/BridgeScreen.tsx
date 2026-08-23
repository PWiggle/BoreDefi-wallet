import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { ChainPicker } from '../components/ChainPicker';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useLedger } from '../context/LedgerContext';
import { useWallet } from '../context/WalletContext';
import { colors, radius, spacing } from '../theme';
import { CHAIN_LIST, type ChainId } from '../wallet/chains';
import { formatTokenAmount, parseTokenAmount } from '../wallet/format';
import {
  ensureSpendAllowance,
  fetchBridgeQuote,
  fetchTokenBalance,
  sendSwapTransaction,
  type SwapQuote,
} from '../wallet/swap';
import { tokensForChain, type TokenConfig } from '../wallet/tokens';

function otherChainId(current: ChainId): ChainId {
  return CHAIN_LIST.find((chain) => chain.id !== current)?.id ?? current;
}

export function BridgeScreen() {
  const { session, selectedChain, setSelectedChain } = useWallet();
  const ledger = useLedger();
  const fromAddress = ledger.account?.address ?? session?.address ?? '';
  const [toChainId, setToChainId] = useState(otherChainId(selectedChain.id));
  const fromTokens = useMemo(() => tokensForChain(selectedChain.id), [selectedChain.id]);
  const toTokens = useMemo(() => tokensForChain(toChainId), [toChainId]);
  const [fromToken, setFromToken] = useState<TokenConfig>(fromTokens[0]!);
  const [toToken, setToToken] = useState<TokenConfig>(toTokens[0]!);
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState(0n);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    const next = tokensForChain(selectedChain.id);
    setFromToken(next[0]!);
    if (toChainId === selectedChain.id) {
      setToChainId(otherChainId(selectedChain.id));
    }
    setQuote(null);
    setTxHash(null);
  }, [selectedChain.id]);

  useEffect(() => {
    setToToken(tokensForChain(toChainId)[0]!);
    setQuote(null);
  }, [toChainId]);

  useEffect(() => {
    if (!session) {
      return;
    }
    fetchTokenBalance(fromAddress, fromToken, selectedChain.id)
      .then(setBalance)
      .catch((err) => setError(err instanceof Error ? err.message : 'Balance failed.'));
  }, [fromAddress, fromToken, selectedChain.id, session]);

  if (!session) {
    return null;
  }

  const quoteBridge = async () => {
    setBusy(true);
    setError(null);
    try {
      const fromAmount = parseTokenAmount(amount, fromToken.decimals);
      if (fromAmount > balance) {
        throw new Error('Amount is larger than the token balance.');
      }
      setQuote(
        await fetchBridgeQuote({
          fromChainId: selectedChain.id,
          toChainId,
          fromToken,
          toToken,
          fromAmount,
          fromAddress,
        }),
      );
    } catch (err) {
      setQuote(null);
      setError(err instanceof Error ? err.message : 'Bridge quote failed.');
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
      setError(err instanceof Error ? err.message : 'Bridge failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Bridge" subtitle="Cross-chain LI.FI routes (fromChain !== toChain).">
      <Text style={styles.copy}>
        Same-chain quotes stay on Swap. The signed transaction is sent on the source chain.
      </Text>
      {error ? <ErrorBanner message={error} /> : null}
      <Text style={styles.label}>From</Text>
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      <View style={styles.row}>
        {fromTokens.map((token) => (
          <Pressable
            key={token.address}
            onPress={() => {
              setFromToken(token);
              setQuote(null);
            }}
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
            onPress={() => {
              setToToken(token);
              setQuote(null);
            }}
            style={[styles.chip, toToken.address === token.address && styles.chipOn]}
          >
            <Text style={styles.chipText}>{token.symbol}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={amount}
        onChangeText={(value) => {
          setAmount(value);
          setQuote(null);
        }}
        keyboardType="decimal-pad"
        placeholder={`Amount (${fromToken.symbol})`}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Text style={styles.meta}>
        Balance {formatTokenAmount(balance, fromToken.decimals)} {fromToken.symbol}
      </Text>
      <Button label="Get quote" onPress={quoteBridge} loading={busy} />
      {quote ? (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>
            Receive ≈ {formatTokenAmount(quote.toAmount, toToken.decimals)} {toToken.symbol} via{' '}
            {quote.toolName}
          </Text>
          <Text style={styles.meta}>
            Minimum {formatTokenAmount(quote.toAmountMin, toToken.decimals)} {toToken.symbol}
          </Text>
          <Button label="Confirm bridge" onPress={confirm} loading={busy} />
        </View>
      ) : null}
      {txHash ? <Text style={styles.hash}>Submitted {txHash}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: { color: colors.muted },
  label: { color: colors.text, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '700' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    padding: spacing.md,
  },
  meta: { color: colors.muted },
  box: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  boxTitle: { color: colors.text, fontWeight: '700' },
  hash: { color: colors.accent },
});
