import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { formatCompactUsd, formatMarketPrice, formatPercent } from '../wallet/format';
import { type MarketCoin } from '../wallet/markets';
import { Sparkline } from './Sparkline';

export function MarketRow({ coin, onPress }: { coin: MarketCoin; onPress: () => void }) {
  const up = (coin.change24h ?? 0) > 0;
  const down = (coin.change24h ?? 0) < 0;
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Text style={styles.rank}>{coin.rank ?? '—'}</Text>
      {coin.imageUrl ? (
        <Image source={{ uri: coin.imageUrl }} style={styles.logo} />
      ) : (
        <View style={[styles.logo, styles.logoFallback]}>
          <Text style={styles.logoLetter}>{coin.symbol.slice(0, 1)}</Text>
        </View>
      )}
      <View style={styles.copy}>
        <Text style={styles.name} numberOfLines={1}>
          {coin.name}
        </Text>
        <Text style={styles.symbol} numberOfLines={1}>
          {coin.symbol}
          {coin.marketCap !== null ? ` · ${formatCompactUsd(coin.marketCap)}` : ''}
        </Text>
      </View>
      <Sparkline points={coin.sparkline} />
      <View style={styles.stats}>
        <Text style={styles.price}>{formatMarketPrice(coin.priceUsd)}</Text>
        <Text style={[styles.change, up && styles.up, down && styles.down]}>{formatPercent(coin.change24h)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rank: {
    color: colors.muted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    width: 28,
  },
  logo: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    height: 28,
    width: 28,
  },
  logoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: colors.text,
    fontWeight: '700',
  },
  symbol: {
    color: colors.muted,
    fontSize: 12,
  },
  stats: {
    alignItems: 'flex-end',
    minWidth: 84,
  },
  price: {
    color: colors.text,
    fontWeight: '700',
  },
  change: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  up: { color: colors.accent },
  down: { color: colors.danger },
});
