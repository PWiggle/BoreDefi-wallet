import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { MarketRow } from '../components/MarketRow';
import { Screen } from '../components/Screen';
import type { MainStackParamList } from '../navigation';
import { colors, radius, spacing } from '../theme';
import {
  COINGECKO_SITE,
  coinGeckoUrl,
  fetchMarketDetails,
  fetchTopMarkets,
  fetchTrendingCoins,
  hydrateMarkets,
  rankGainers,
  searchMarkets,
  type MarketCoin,
} from '../wallet/markets';

type Tab = 'all' | 'trending' | 'gainers';

export function DiscoverScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [markets, setMarkets] = useState<MarketCoin[]>([]);
  const [trending, setTrending] = useState<MarketCoin[]>([]);
  const [results, setResults] = useState<MarketCoin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextMarkets, nextTrending] = await Promise.all([
        fetchTopMarkets(100),
        fetchTrendingCoins().catch(() => [] as MarketCoin[]),
      ]);
      setMarkets(nextMarkets);
      const extraIds = nextTrending
        .filter((item) => !nextMarkets.some((row) => row.id === item.id))
        .map((item) => item.id);
      const extra = extraIds.length > 0 ? await fetchMarketDetails(extraIds).catch(() => [] as MarketCoin[]) : [];
      setTrending(hydrateMarkets(nextTrending, [...nextMarkets, ...extra]));
      if (nextMarkets.length === 0) {
        setError('CoinGecko returned no markets. Pull to refresh or tap Retry.');
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
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const hits = await searchMarkets(trimmed);
      const details = await fetchMarketDetails(hits.map((item) => item.id));
      setResults(hydrateMarkets(hits, details));
      if (hits.length === 0) {
        setError('No CoinGecko results for that search.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  };

  const openCoin = (coin: MarketCoin) => {
    navigation.navigate('Browser', { url: coinGeckoUrl(coin.id) });
  };

  const searching = Boolean(query.trim() && results.length > 0);
  const list = searching ? results : tab === 'trending' ? trending : tab === 'gainers' ? rankGainers(markets) : markets;

  return (
    <Screen
      title="Markets"
      subtitle="CoinGecko inside BoreDefi. Live public data, no API key."
      refreshing={busy}
      onRefresh={load}
    >
      <ErrorBanner message={error} />
      {error ? <Button label="Retry" onPress={load} loading={busy} /> : null}
      <Button label="Open CoinGecko" onPress={() => navigation.navigate('Browser', { url: COINGECKO_SITE })} />
      <TextInput
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          if (!value.trim()) {
            setResults([]);
          }
        }}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Search CoinGecko"
        placeholderTextColor={colors.muted}
        style={styles.input}
        onSubmitEditing={runSearch}
      />
      <Button label="Search" onPress={runSearch} loading={busy} variant="secondary" />
      {!searching ? (
        <View style={styles.tabs}>
          {(['all', 'trending', 'gainers'] as Tab[]).map((item) => (
            <Pressable
              key={item}
              onPress={() => setTab(item)}
              style={[styles.tab, tab === item && styles.tabOn]}
            >
              <Text style={[styles.tabText, tab === item && styles.tabTextOn]}>
                {item === 'all' ? 'All' : item === 'trending' ? 'Trending' : 'Gainers'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={styles.heading}>
        {searching ? 'Search' : tab === 'trending' ? 'Trending' : tab === 'gainers' ? 'Top gainers (24h)' : 'Top markets'}
      </Text>
      {list.length === 0 && !busy ? (
        <Text style={styles.empty}>No live markets loaded. Tap Retry.</Text>
      ) : null}
      {list.map((coin) => (
        <MarketRow key={`${searching ? 'search' : tab}-${coin.id}`} coin={coin} onPress={() => openCoin(coin)} />
      ))}
    </Screen>
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
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tab: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tabOn: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  tabText: {
    color: colors.muted,
    fontWeight: '700',
  },
  tabTextOn: {
    color: colors.accent,
  },
  heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
  empty: { color: colors.muted },
});
