import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';

import { AssetRow } from '../components/AssetRow';
import { ChainPicker } from '../components/ChainPicker';
import { CircleAction } from '../components/CircleAction';
import { ErrorBanner } from '../components/ErrorBanner';
import { MarketRow } from '../components/MarketRow';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import type { MainNavigation } from '../navigation';
import { card, colors, radius, spacing, type } from '../theme';
import { fetchActivity, type ActivityItem } from '../wallet/activity';
import { formatNative, formatTimestamp, formatUsd, shortenAddress } from '../wallet/format';
import {
  fetchMarketDetails,
  fetchTopMarkets,
  fetchTrendingCoins,
  geckoIdForNative,
  geckoIdForToken,
  indexMarketsById,
  portfolioTokensForChain,
  type MarketCoin,
  usdValueFromUnits,
} from '../wallet/markets';
import { fetchBalance } from '../wallet/rpc';
import { fetchTokenBalance } from '../wallet/swap';
import { type TokenConfig } from '../wallet/tokens';

type TokenRow = {
  token: TokenConfig;
  amount: bigint;
  market: MarketCoin | undefined;
};

export function HomeScreen() {
  const navigation = useNavigation<MainNavigation>();
  const { session, selectedChain, setSelectedChain } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [nativeMarket, setNativeMarket] = useState<MarketCoin | undefined>(undefined);
  const [strip, setStrip] = useState<MarketCoin[]>([]);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setError(null);
    setMarketsError(null);
    try {
      const portfolio = portfolioTokensForChain(selectedChain.id);
      const geckoIds = [...new Set(portfolio.map((item) => geckoIdForToken(item)).filter((id): id is string => Boolean(id)))];
      const [nextBalance, nextActivity, details, nextStrip] = await Promise.all([
        fetchBalance(session.address, selectedChain.id),
        fetchActivity(session.address, selectedChain.id, 5),
        fetchMarketDetails(geckoIds).catch(() => {
          setMarketsError('Could not load live CoinGecko prices.');
          return [] as MarketCoin[];
        }),
        fetchTopMarkets(8).catch(() => fetchTrendingCoins().catch(() => [] as MarketCoin[])),
      ]);
      const byId = indexMarketsById(details);
      const erc20 = portfolio.filter((item) => !item.native);
      const erc20Balances = await Promise.all(
        erc20.map((item) => fetchTokenBalance(session.address, item, selectedChain.id).catch(() => 0n)),
      );
      const amountByAddress = new Map(
        erc20.map((item, index) => [item.address.toLowerCase(), erc20Balances[index] ?? 0n]),
      );
      const nextTokens: TokenRow[] = portfolio.map((item) => {
        const geckoId = geckoIdForToken(item);
        const amount = item.native ? nextBalance : (amountByAddress.get(item.address.toLowerCase()) ?? 0n);
        return {
          token: item,
          amount,
          market: geckoId ? byId.get(geckoId) : undefined,
        };
      });
      setBalance(nextBalance);
      setActivity(nextActivity);
      setTokens(nextTokens);
      setNativeMarket(byId.get(geckoIdForNative(selectedChain.id)));
      setStrip(nextStrip.slice(0, 6));
      if (details.length === 0 && nextStrip.length === 0) {
        setMarketsError('Could not load live CoinGecko prices.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh wallet.');
    }
  }, [selectedChain.id, session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!session) {
    return null;
  }

  const copy = async () => {
    await Clipboard.setStringAsync(session.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const usdTotal = balance === null ? null : usdValueFromUnits(balance, 18, nativeMarket?.priceUsd);

  return (
    <Screen
      inset="tab"
      title="Wallet"
      subtitle={selectedChain.name}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Available</Text>
        <Text style={styles.heroUsd}>{formatUsd(usdTotal)}</Text>
        <Text style={styles.heroNative}>
          {balance === null ? '—' : formatNative(balance)} {selectedChain.symbol}
        </Text>
        <Pressable onPress={copy}>
          <Text style={styles.address}>{copied ? 'Copied' : shortenAddress(session.address)}</Text>
        </Pressable>
      </View>
      <View style={styles.rail}>
        <CircleAction label="Send" name="send" onPress={() => navigation.navigate('Send', {})} />
        <CircleAction label="Receive" name="receive" onPress={() => navigation.navigate('Receive')} />
        <CircleAction label="Swap" name="swap" onPress={() => navigation.navigate('Swap', {})} />
        <CircleAction label="Stake" name="stake" onPress={() => navigation.navigate('Stake', {})} />
        <CircleAction label="Bridge" name="bridge" onPress={() => navigation.navigate('Bridge')} />
      </View>
      <ErrorBanner message={error} />
      <ErrorBanner message={marketsError} />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tokens</Text>
        {tokens.length === 0 ? (
          <Text style={styles.empty}>Loading token prices…</Text>
        ) : (
          tokens.map((row) => (
            <AssetRow
              key={`${row.token.chainId}-${row.token.address}-${row.token.symbol}`}
              token={row.token}
              amount={row.amount}
              market={row.market}
              onPress={() =>
                row.token.native
                  ? navigation.navigate('Send', {})
                  : navigation.navigate('Swap', { fromSymbol: row.token.symbol })
              }
            />
          ))
        )}
      </View>
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Markets</Text>
          <Pressable onPress={() => navigation.navigate('Markets')}>
            <Text style={styles.link}>See all</Text>
          </Pressable>
        </View>
        {strip.length === 0 ? (
          <Text style={styles.empty}>Live CoinGecko markets are offline or rate-limited.</Text>
        ) : (
          strip.map((coin) => (
            <MarketRow key={coin.id} coin={coin} onPress={() => navigation.navigate('Markets')} />
          ))
        )}
      </View>
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Recent</Text>
          <Pressable onPress={() => navigation.navigate('Activity')}>
            <Text style={styles.link}>Activity</Text>
          </Pressable>
        </View>
        {activity.length === 0 ? (
          <Text style={styles.empty}>No transactions on {selectedChain.name} yet.</Text>
        ) : (
          activity.slice(0, 3).map((item) => (
            <Pressable key={item.hash} onPress={() => navigation.navigate('Activity')} style={styles.tx}>
              <Text style={styles.txDir}>{item.inbound ? 'Received' : 'Sent'}</Text>
              <Text style={styles.txAmt}>
                {item.inbound ? '+' : '−'}
                {formatNative(item.valueWei)} {selectedChain.symbol}
              </Text>
              <Text style={styles.txMeta}>{formatTimestamp(item.timestamp)}</Text>
            </Pressable>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    ...card,
    borderRadius: radius.lg,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  heroLabel: type.label,
  heroUsd: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  heroNative: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '600',
  },
  address: {
    color: colors.accent,
    fontWeight: '700',
  },
  rail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  section: {
    gap: spacing.sm,
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  link: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  empty: {
    color: colors.muted,
  },
  tx: {
    ...card,
    gap: 2,
  },
  txDir: type.label,
  txAmt: {
    color: colors.text,
    fontWeight: '700',
  },
  txMeta: type.meta,
});
