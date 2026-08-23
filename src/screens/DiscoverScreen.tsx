import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { colors, radius, spacing } from '../theme';
import { type ChainId } from '../wallet/chains';
import { formatCompactUsd, formatPercent } from '../wallet/format';
import {
  actionsForMarket,
  fetchMarketDetails,
  fetchTopMarkets,
  fetchTrendingCoins,
  searchMarkets,
  type MarketCoin,
} from '../wallet/markets';

export function DiscoverScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { selectedChain, setSelectedChain } = useWallet();
  const [query, setQuery] = useState('');
  const [trending, setTrending] = useState<MarketCoin[]>([]);
  const [markets, setMarkets] = useState<MarketCoin[]>([]);
  const [results, setResults] = useState<MarketCoin[]>([]);
  const [selected, setSelected] = useState<MarketCoin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const nextMarkets = await fetchTopMarkets();
      setMarkets(nextMarkets);
      const nextTrending = await fetchTrendingCoins().catch(() => [] as MarketCoin[]);
      setTrending(nextTrending);
      if (nextMarkets.length === 0) {
        setError('CoinGecko returned no markets. Tap Retry.');
      }
    } catch (err) {
      setMarkets([]);
      setTrending([]);
      setError(err instanceof Error ? err.message : 'Could not load CoinGecko markets.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runSearch = async () => {
    setBusy(true);
    setError(null);
    try {
      const hits = await searchMarkets(query);
      const details = await fetchMarketDetails(hits.map((item) => item.id));
      const byId = new Map(details.map((item) => [item.id, item]));
      setResults(hits.map((item) => byId.get(item.id) ?? item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  };

  const open = async (coin: MarketCoin) => {
    setSelected(coin);
    if (coin.priceUsd === null) {
      try {
        const [detail] = await fetchMarketDetails([coin.id]);
        if (detail) {
          setSelected(detail);
        }
      } catch {
        // Keep the search row if stats are rate-limited.
      }
    }
  };

  const go = async (coin: MarketCoin, kind: 'send' | 'swap' | 'stake') => {
    const actions = actionsForMarket(coin, selectedChain.id);
    if (kind === 'send' && actions.sendChainId) {
      await setSelectedChain(actions.sendChainId);
      navigation.navigate('Send', {});
      return;
    }
    if (kind === 'swap' && actions.swapSymbol) {
      navigation.navigate('Swap', { fromSymbol: actions.swapSymbol });
      return;
    }
    if (kind === 'stake' && actions.stakeMarketId) {
      if (actions.stakeChainId) {
        await setSelectedChain(actions.stakeChainId);
      }
      navigation.navigate('Stake', { marketId: actions.stakeMarketId });
    }
  };

  const searching = Boolean(query.trim() && results.length > 0);
  const list = searching ? results : markets;

  return (
    <Screen title="Discover" subtitle="Public CoinGecko stats. No API key.">
      <ErrorBanner message={error} />
      {error ? <Button label="Retry" onPress={load} loading={busy} /> : null}
      <TextInput
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Search tokens"
        placeholderTextColor={colors.muted}
        style={styles.input}
        onSubmitEditing={runSearch}
      />
      <Button label="Search" onPress={runSearch} loading={busy} />
      {selected ? <CoinCard coin={selected} chainId={selectedChain.id} onAction={go} /> : null}
      <Text style={styles.heading}>{searching ? 'Search' : 'Top markets'}</Text>
      {list.length === 0 && !busy && !searching ? (
        <Text style={styles.empty}>No live markets loaded. Tap Retry.</Text>
      ) : null}
      {list.map((coin) => (
        <Pressable key={coin.id} onPress={() => open(coin)} style={styles.row}>
          <View style={styles.rowCopy}>
            <Text style={styles.symbol}>
              {coin.rank ? `#${coin.rank} ` : ''}
              {coin.symbol}
            </Text>
            <Text style={styles.name}>
              {searching
                ? coin.name
                : `Cap ${formatCompactUsd(coin.marketCap)} · Vol ${formatCompactUsd(coin.volume24h)}`}
            </Text>
          </View>
          <View>
            <Text style={styles.price}>{formatCompactUsd(coin.priceUsd)}</Text>
            <Text style={styles.change}>{formatPercent(coin.change24h)}</Text>
          </View>
        </Pressable>
      ))}
      {!searching && trending.length > 0 ? (
        <>
          <Text style={styles.heading}>Trending</Text>
          {trending.slice(0, 6).map((coin) => (
            <Pressable key={`trend-${coin.id}`} onPress={() => open(coin)} style={styles.row}>
              <View style={styles.rowCopy}>
                <Text style={styles.symbol}>{coin.symbol}</Text>
                <Text style={styles.name}>{coin.name}</Text>
              </View>
              <View>
                <Text style={styles.price}>{formatCompactUsd(coin.priceUsd)}</Text>
                <Text style={styles.change}>{formatPercent(coin.change24h)}</Text>
              </View>
            </Pressable>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function CoinCard({
  coin,
  chainId,
  onAction,
}: {
  coin: MarketCoin;
  chainId: ChainId;
  onAction: (coin: MarketCoin, kind: 'send' | 'swap' | 'stake') => void;
}) {
  const actions = actionsForMarket(coin, chainId);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {coin.name} · {coin.symbol}
      </Text>
      <Text style={styles.meta}>Price {formatCompactUsd(coin.priceUsd)}</Text>
      <Text style={styles.meta}>Market cap {formatCompactUsd(coin.marketCap)}</Text>
      <Text style={styles.meta}>24h volume {formatCompactUsd(coin.volume24h)}</Text>
      <Text style={styles.meta}>24h {formatPercent(coin.change24h)}</Text>
      <View style={styles.actions}>
        <Button
          label="Send"
          disabled={!actions.send}
          onPress={() => onAction(coin, 'send')}
          style={styles.action}
        />
        <Button
          label="Swap"
          variant="secondary"
          disabled={!actions.swap}
          onPress={() => onAction(coin, 'swap')}
          style={styles.action}
        />
      </View>
      <Button label="Stake" variant="secondary" disabled={!actions.stake} onPress={() => onAction(coin, 'stake')} />
      {!actions.send && !actions.swap && !actions.stake ? (
        <Text style={styles.meta}>This token is not on the in-app send/swap/stake list.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    padding: spacing.md,
  },
  heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
  empty: { color: colors.muted },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  rowCopy: { flex: 1, gap: 2 },
  symbol: { color: colors.text, fontWeight: '700' },
  name: { color: colors.muted, fontSize: 13 },
  price: { color: colors.text, fontWeight: '700' },
  change: { color: colors.muted, fontSize: 12, textAlign: 'right' },
  card: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.accent,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardTitle: { color: colors.text, fontWeight: '800' },
  meta: { color: colors.muted },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
