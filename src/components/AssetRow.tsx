import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { formatMarketPrice, formatPercent, formatTokenAmount, formatUsd } from '../wallet/format';
import { type MarketCoin, usdValueFromUnits } from '../wallet/markets';
import { type TokenConfig } from '../wallet/tokens';
import { Sparkline } from './Sparkline';

export function AssetRow({
  token,
  amount,
  market,
  onPress,
}: {
  token: TokenConfig;
  amount: bigint;
  market?: MarketCoin;
  onPress: () => void;
}) {
  const usd = usdValueFromUnits(amount, token.decimals, market?.priceUsd);
  const up = (market?.change24h ?? 0) > 0;
  const down = (market?.change24h ?? 0) < 0;
  return (
    <Pressable onPress={onPress} style={styles.row}>
      {market?.imageUrl ? (
        <Image source={{ uri: market.imageUrl }} style={styles.logo} />
      ) : (
        <View style={[styles.logo, styles.logoFallback]}>
          <Text style={styles.logoLetter}>{token.symbol.slice(0, 1)}</Text>
        </View>
      )}
      <View style={styles.copy}>
        <Text style={styles.name} numberOfLines={1}>
          {token.symbol}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatTokenAmount(amount, token.decimals)} · {formatMarketPrice(market?.priceUsd)}
        </Text>
      </View>
      <Sparkline points={market?.sparkline ?? []} />
      <View style={styles.stats}>
        <Text style={styles.price}>{formatUsd(usd)}</Text>
        <Text style={[styles.change, up && styles.up, down && styles.down]}>{formatPercent(market?.change24h)}</Text>
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
  meta: {
    color: colors.muted,
    fontSize: 12,
  },
  stats: {
    alignItems: 'flex-end',
    minWidth: 72,
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
