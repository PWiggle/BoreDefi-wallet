import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';

import { Button } from '../components/Button';
import { ChainPicker } from '../components/ChainPicker';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { colors, radius, spacing } from '../theme';
import { fetchActivity, type ActivityItem } from '../wallet/activity';
import { formatCompactUsd, formatNative, formatPercent, formatTokenAmount, formatTimestamp, formatUsd, shortenAddress } from '../wallet/format';
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
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
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
      scroll
      title="Wallet"
      subtitle={selectedChain.name}
    >
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Available</Text>
        <Text style={styles.heroUsd}>{formatUsd(usdTotal)}</Text>
        <Text style={styles.balance}>
          {balance === null ? '—' : formatNative(balance)} {selectedChain.symbol}
        </Text>
        <Pressable onPress={copy}>
          <Text style={styles.address}>{copied ? 'Copied' : shortenAddress(session.address)}</Text>
        </Pressable>
      </View>
      <ErrorBanner message={error} />
      <ErrorBanner message={marketsError} />
      <View style={styles.actions}>
        <Button label="Send" style={styles.action} onPress={() => navigation.navigate('Send', {})} />
        <Button
          label="Receive"
          variant="secondary"
          style={styles.action}
          onPress={() => navigation.navigate('Receive')}
        />
      </View>
      <View style={styles.actions}>
        <Button label="Swap" style={styles.action} onPress={() => navigation.navigate('Swap', {})} />
        <Button
          label="Bridge"
          variant="secondary"
          style={styles.action}
          onPress={() => navigation.navigate('Bridge')}
        />
      </View>
      <View style={styles.actions}>
        <Button label="Stake" style={styles.action} onPress={() => navigation.navigate('Stake', {})} />
        <Button
          label="NFTs"
          variant="secondary"
          style={styles.action}
          onPress={() => navigation.navigate('Nfts')}
        />
      </View>
      <View style={styles.actions}>
        <Button label="Browser" style={styles.action} onPress={() => navigation.navigate('Browser', {})} />
        <Button
          label="Connect"
          variant="secondary"
          style={styles.action}
          onPress={() => navigation.navigate('WalletConnect', {})}
        />
      </View>
      <View style={styles.actions}>
        <Button label="Discover" style={styles.action} onPress={() => navigation.navigate('Discover')} />
        <Button
          label="Ledger"
          variant="secondary"
          style={styles.action}
          onPress={() => navigation.navigate('Ledger')}
        />
      </View>
      <Button label="Activity" variant="secondary" onPress={() => navigation.navigate('Activity')} />
      <View style={styles.recent}>
        <Text style={styles.recentTitle}>Tokens</Text>
        {tokens.length === 0 ? (
          <Text style={styles.empty}>Loading token prices…</Text>
        ) : (
          tokens.map((row) => (
            <Pressable
              key={`${row.token.chainId}-${row.token.address}-${row.token.symbol}`}
              onPress={() =>
                row.token.native
                  ? navigation.navigate('Send', {})
                  : navigation.navigate('Swap', { fromSymbol: row.token.symbol })
              }
              style={styles.tokenRow}
            >
              <View style={styles.tokenCopy}>
                <Text style={styles.tokenSymbol}>{row.token.symbol}</Text>
                <Text style={styles.tokenName}>{row.token.name}</Text>
                <Text style={styles.tokenAmt}>
                  {formatTokenAmount(row.amount, row.token.decimals)} {row.token.symbol}
                </Text>
              </View>
              <View style={styles.tokenStats}>
                <Text style={styles.tokenPrice}>{formatUsd(row.market?.priceUsd)}</Text>
                <Text style={[styles.tokenChange, changeStyle(row.market?.change24h)]}>
                  {formatPercent(row.market?.change24h)}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </View>
      <View style={styles.recent}>
        <Text style={styles.recentTitle}>Markets</Text>
        {strip.length === 0 ? (
          <Text style={styles.empty}>Live CoinGecko markets are offline or rate-limited.</Text>
        ) : (
          strip.map((coin) => (
            <Pressable key={coin.id} onPress={() => navigation.navigate('Discover')} style={styles.tokenRow}>
              <View style={styles.tokenCopy}>
                <Text style={styles.tokenSymbol}>
                  {coin.rank ? `#${coin.rank} ` : ''}
                  {coin.symbol}
                </Text>
                <Text style={styles.tokenName}>{coin.name}</Text>
              </View>
              <View style={styles.tokenStats}>
                <Text style={styles.tokenPrice}>{formatCompactUsd(coin.priceUsd)}</Text>
                <Text style={[styles.tokenChange, changeStyle(coin.change24h)]}>{formatPercent(coin.change24h)}</Text>
              </View>
            </Pressable>
          ))
        )}
      </View>
      <Button label="Refresh" variant="ghost" loading={refreshing} onPress={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }} />
      <View style={styles.recent}>
        <Text style={styles.recentTitle}>Recent</Text>
        {activity.length === 0 ? (
          <Text style={styles.empty}>No transactions on {selectedChain.name} yet.</Text>
        ) : (
          activity.map((item) => (
            <View key={item.hash} style={styles.tx}>
              <Text style={styles.txDir}>{item.inbound ? 'Received' : 'Sent'}</Text>
              <Text style={styles.txAmt}>
                {item.inbound ? '+' : '−'}
                {formatNative(item.valueWei)} {selectedChain.symbol}
              </Text>
              <Text style={styles.txMeta}>{formatTimestamp(item.timestamp)}</Text>
            </View>
          ))
        )}
      </View>
      <Button label="Settings" variant="ghost" onPress={() => navigation.navigate('Settings')} />
    </Screen>
  );
}

function changeStyle(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return styles.changeFlat;
  }
  return value > 0 ? styles.changeUp : styles.changeDown;
}

const styles = StyleSheet.create({
  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  balanceLabel: {
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 12,
  },
  heroUsd: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '800',
  },
  balance: {
    color: colors.muted,
    fontSize: 16,
    fontWeight: '600',
  },
  address: {
    color: colors.accent,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
  recent: {
    gap: spacing.sm,
  },
  recentTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 18,
  },
  empty: {
    color: colors.muted,
  },
  tokenRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  tokenCopy: {
    flex: 1,
    gap: 2,
  },
  tokenSymbol: {
    color: colors.text,
    fontWeight: '700',
  },
  tokenName: {
    color: colors.muted,
    fontSize: 13,
  },
  tokenAmt: {
    color: colors.muted,
    fontSize: 12,
  },
  tokenStats: {
    alignItems: 'flex-end',
    gap: 2,
  },
  tokenPrice: {
    color: colors.text,
    fontWeight: '700',
  },
  tokenChange: {
    fontSize: 12,
    fontWeight: '600',
  },
  changeUp: {
    color: colors.accent,
  },
  changeDown: {
    color: colors.danger,
  },
  changeFlat: {
    color: colors.muted,
  },
  tx: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: 4,
  },
  txDir: {
    color: colors.muted,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  txAmt: {
    color: colors.text,
    fontWeight: '700',
  },
  txMeta: {
    color: colors.muted,
    fontSize: 12,
  },
});
