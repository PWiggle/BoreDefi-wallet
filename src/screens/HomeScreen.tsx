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
import { formatCompactUsd, formatNative, formatTimestamp, shortenAddress } from '../wallet/format';
import { fetchTrendingCoins, type MarketCoin } from '../wallet/markets';
import { fetchBalance } from '../wallet/rpc';

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { session, selectedChain, setSelectedChain } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [trending, setTrending] = useState<MarketCoin[]>([]);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setError(null);
    try {
      const [nextBalance, nextActivity, nextTrending] = await Promise.all([
        fetchBalance(session.address, selectedChain.id),
        fetchActivity(session.address, selectedChain.id, 5),
        fetchTrendingCoins().catch(() => [] as MarketCoin[]),
      ]);
      setBalance(nextBalance);
      setActivity(nextActivity);
      setTrending(nextTrending.slice(0, 4));
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

  return (
    <Screen
      scroll
      title="Wallet"
      subtitle={selectedChain.name}
    >
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Available</Text>
        <Text style={styles.balance}>
          {balance === null ? '—' : formatNative(balance)} {selectedChain.symbol}
        </Text>
        <Pressable onPress={copy}>
          <Text style={styles.address}>{copied ? 'Copied' : shortenAddress(session.address)}</Text>
        </Pressable>
      </View>
      <ErrorBanner message={error} />
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
        <Button label="Browser" style={styles.action} onPress={() => navigation.navigate('Browser')} />
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
        <Text style={styles.recentTitle}>Discover</Text>
        {trending.length === 0 ? (
          <Text style={styles.empty}>Market data is offline or rate-limited.</Text>
        ) : (
          trending.map((coin) => (
            <Pressable key={coin.id} onPress={() => navigation.navigate('Discover')} style={styles.tx}>
              <Text style={styles.txDir}>{coin.symbol}</Text>
              <Text style={styles.txAmt}>
                {formatCompactUsd(coin.priceUsd)} {coin.name}
              </Text>
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
  balance: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '800',
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
