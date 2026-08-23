import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { ChainPicker } from '../components/ChainPicker';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import { colors, radius, spacing } from '../theme';
import { formatTokenAmount, parseTokenAmount } from '../wallet/format';
import {
  claimLidoRequests,
  fetchStakedBalance,
  listLidoRequests,
  listStakeMarkets,
  stake,
  unstake,
  type StakeMarket,
  type WithdrawalRequest,
} from '../wallet/stake';
import { fetchTokenBalance } from '../wallet/swap';

function stakedLabel(market: StakeMarket): string {
  return market.protocol === 'lido' ? 'stETH' : `a${market.asset.symbol}`;
}

export function StakeScreen() {
  const { session, selectedChain, setSelectedChain } = useWallet();
  const markets = useMemo(
    () => listStakeMarkets().filter((item) => item.chainId === selectedChain.id),
    [selectedChain.id],
  );
  const [market, setMarket] = useState<StakeMarket | undefined>(markets[0]);
  const [amount, setAmount] = useState('');
  const [walletBalance, setWalletBalance] = useState(0n);
  const [stakedBalance, setStakedBalance] = useState(0n);
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    const next = listStakeMarkets().filter((item) => item.chainId === selectedChain.id);
    setMarket(next[0]);
    setAmount('');
    setTxHash(null);
    setRequests([]);
  }, [selectedChain.id]);

  useEffect(() => {
    if (!session || !market) {
      return;
    }
    fetchTokenBalance(session.address, market.asset, market.chainId)
      .then(setWalletBalance)
      .catch((err) => setError(err instanceof Error ? err.message : 'Balance failed.'));
    fetchStakedBalance(market, session.address)
      .then(setStakedBalance)
      .catch((err) => setError(err instanceof Error ? err.message : 'Staked balance failed.'));
    if (market.protocol === 'lido') {
      listLidoRequests(session.address)
        .then(setRequests)
        .catch(() => setRequests([]));
    }
  }, [market, session]);

  if (!session) {
    return null;
  }

  if (!market) {
    return (
      <Screen title="Stake" subtitle={selectedChain.name}>
        <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
        <Text style={styles.copy}>
          No stake markets on {selectedChain.name}. Switch to Ethereum for Lido ETH, or Ethereum /
          Base / Arbitrum / Optimism / Polygon / Avalanche for Aave V3 USDC.
        </Text>
      </Screen>
    );
  }

  const run = async (action: 'stake' | 'unstake') => {
    setBusy(true);
    setError(null);
    try {
      const value = parseTokenAmount(amount, market.asset.decimals);
      const result =
        action === 'stake'
          ? await stake({
              mnemonic: session.mnemonic,
              market,
              owner: session.address,
              amount: value,
            })
          : await unstake({
              mnemonic: session.mnemonic,
              market,
              owner: session.address,
              amount: value,
            });
      setTxHash(result.hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stake action failed.');
    } finally {
      setBusy(false);
    }
  };

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await claimLidoRequests(session.mnemonic, session.address);
      setTxHash(result.hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Stake" subtitle={selectedChain.name}>
      <Text style={styles.copy}>
        Lido ETH on Ethereum (withdrawal queue) and Aave V3 USDC supply on supported L2s. Keys stay
        on device.
      </Text>
      {error ? <ErrorBanner message={error} /> : null}
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      <View style={styles.row}>
        {markets.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => setMarket(item)}
            style={[styles.chip, market.id === item.id && styles.chipOn]}
          >
            <Text style={styles.chipText}>{item.title}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.copy}>{market.subtitle}</Text>
      <Text style={styles.meta}>
        Wallet {market.asset.symbol}: {formatTokenAmount(walletBalance, market.asset.decimals)}
      </Text>
      <Text style={styles.meta}>
        Position: {formatTokenAmount(stakedBalance, market.asset.decimals)} {stakedLabel(market)}
      </Text>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder={`Amount (${market.asset.symbol})`}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <View style={styles.actions}>
        <Button label="Stake" onPress={() => run('stake')} loading={busy} />
        <Button label="Unstake" variant="secondary" onPress={() => run('unstake')} loading={busy} />
      </View>
      {market.protocol === 'lido' && requests.length > 0 ? (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>Lido withdrawal queue</Text>
          {requests.map((item) => (
            <Text key={item.id.toString()} style={styles.meta}>
              #{item.id.toString()} · {formatTokenAmount(item.amount, 18)} stETH ·{' '}
              {item.claimed ? 'claimed' : item.finalized ? 'ready to claim' : 'pending'}
            </Text>
          ))}
          <Button
            label="Claim finalized"
            onPress={claim}
            loading={busy}
            disabled={!requests.some((item) => item.finalized && !item.claimed)}
          />
        </View>
      ) : null}
      {txHash ? <Text style={styles.hash}>Submitted {txHash}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: { color: colors.muted },
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
  meta: { color: colors.muted },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    padding: spacing.md,
  },
  actions: { gap: spacing.sm },
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
