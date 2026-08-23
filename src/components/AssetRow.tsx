import { Image, Pressable, Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { formatMarketPrice, formatPercent, formatTokenAmount, formatUsd } from '../wallet/format';
import { type MarketCoin, usdValueFromUnits } from '../wallet/markets';
import { type TokenConfig } from '../wallet/tokens';
import { Sparkline } from './Sparkline';

function assetStyles({ colors, radius, spacing }: Theme) {
  return {
    row: {
      alignItems: 'center' as const,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: 'row' as const,
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
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    logoLetter: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '800' as const,
    },
    copy: {
      flex: 1,
      minWidth: 0,
    },
    name: {
      color: colors.text,
      fontWeight: '700' as const,
    },
    meta: {
      color: colors.muted,
      fontSize: 12,
    },
    stats: {
      alignItems: 'flex-end' as const,
      minWidth: 72,
    },
    price: {
      color: colors.text,
      fontWeight: '700' as const,
    },
    change: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: '600' as const,
    },
    up: { color: colors.accent },
    down: { color: colors.danger },
  };
}

export function AssetRow({
  token,
  amount,
  market,
  onPress,
  hideBalances,
}: {
  token: TokenConfig;
  amount: bigint;
  market?: MarketCoin;
  onPress: () => void;
  hideBalances?: boolean;
}) {
  const styles = useThemedStyles(assetStyles);
  const usd = usdValueFromUnits(amount, token.decimals, market?.priceUsd);
  const up = (market?.change24h ?? 0) > 0;
  const down = (market?.change24h ?? 0) < 0;
  const amountLabel = hideBalances ? '••••' : formatTokenAmount(amount, token.decimals);
  const usdLabel = hideBalances ? '••••' : formatUsd(usd);
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
          {amountLabel} · {formatMarketPrice(market?.priceUsd)}
        </Text>
      </View>
      <Sparkline points={market?.sparkline ?? []} />
      <View style={styles.stats}>
        <Text style={styles.price}>{usdLabel}</Text>
        <Text style={[styles.change, up && styles.up, down && styles.down]}>{formatPercent(market?.change24h)}</Text>
      </View>
    </Pressable>
  );
}
