import { useEffect, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { formatCompactUsd, formatMarketPrice, formatPercent } from '../wallet/format';
import {
  coinGeckoUrl,
  fetchCoinPage,
  fetchTopMarkets,
  parseCoinGeckoCoinId,
  type CoinPage,
  type MarketCoin,
} from '../wallet/markets';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { MarketRow } from './MarketRow';
import { Sparkline } from './Sparkline';

function embedStyles({ colors, radius, spacing }: Theme) {
  return {
    embed: {
      backgroundColor: colors.bg,
      flex: 1,
    },
    embedBody: {
      gap: spacing.sm,
      padding: spacing.md,
    },
    kicker: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: '800' as const,
      letterSpacing: 1,
      textTransform: 'uppercase' as const,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '800' as const,
    },
    copy: {
      color: colors.muted,
      lineHeight: 20,
    },
    hero: {
      alignItems: 'center' as const,
      flexDirection: 'row' as const,
      gap: spacing.md,
    },
    heroLogo: {
      borderRadius: 20,
      height: 40,
      width: 40,
    },
    heroCopy: {
      flex: 1,
    },
    heroPrice: {
      color: colors.text,
      fontSize: 32,
      fontWeight: '800' as const,
    },
    heroChange: {
      color: colors.muted,
      fontWeight: '700' as const,
    },
    up: { color: colors.accent },
    down: { color: colors.danger },
    chart: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      padding: spacing.sm,
    },
    meta: {
      color: colors.text,
      fontWeight: '600' as const,
    },
  };
}

export function CoinGeckoWebEmbed({ url, onOpenUrl }: { url: string; onOpenUrl: (next: string) => void }) {
  const styles = useThemedStyles(embedStyles);
  const coinId = parseCoinGeckoCoinId(url);
  if (coinId) {
    return <CoinDetail id={coinId} />;
  }
  return <MarketsHome onOpenUrl={onOpenUrl} />;
}

function MarketsHome({ onOpenUrl }: { onOpenUrl: (next: string) => void }) {
  const styles = useThemedStyles(embedStyles);
  const [rows, setRows] = useState<MarketCoin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await fetchTopMarkets(100);
      setRows(next);
      if (next.length === 0) {
        setError('CoinGecko returned no markets. Tap Retry.');
      }
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Could not load CoinGecko.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <ScrollView style={styles.embed} contentContainerStyle={styles.embedBody}>
      <Text style={styles.kicker}>CoinGecko</Text>
      <Text style={styles.title}>Cryptocurrency Prices by Market Cap</Text>
      <Text style={styles.copy}>Live public CoinGecko markets inside BoreDefi. No API key.</Text>
      <ErrorBanner message={error} />
      {error ? <Button label="Retry" onPress={load} loading={busy} /> : null}
      {rows.map((coin) => (
        <MarketRow key={coin.id} coin={coin} onPress={() => onOpenUrl(coinGeckoUrl(coin.id))} />
      ))}
    </ScrollView>
  );
}

function CoinDetail({ id }: { id: string }) {
  const styles = useThemedStyles(embedStyles);
  const [coin, setCoin] = useState<CoinPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setCoin(await fetchCoinPage(id));
    } catch (err) {
      setCoin(null);
      setError(err instanceof Error ? err.message : 'Could not load this CoinGecko coin.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  return (
    <ScrollView style={styles.embed} contentContainerStyle={styles.embedBody}>
      <Text style={styles.kicker}>CoinGecko</Text>
      <ErrorBanner message={error} />
      {error ? <Button label="Retry" onPress={load} loading={busy} /> : null}
      {coin ? (
        <>
          <View style={styles.hero}>
            {coin.imageUrl ? <Image source={{ uri: coin.imageUrl }} style={styles.heroLogo} /> : null}
            <View style={styles.heroCopy}>
              <Text style={styles.title}>
                {coin.name} ({coin.symbol})
              </Text>
              <Text style={styles.copy}>{coin.rank ? `Rank #${coin.rank}` : 'Live CoinGecko stats'}</Text>
            </View>
          </View>
          <Text style={styles.heroPrice}>{formatMarketPrice(coin.priceUsd)}</Text>
          <Text
            style={[
              styles.heroChange,
              (coin.change24h ?? 0) > 0 && styles.up,
              (coin.change24h ?? 0) < 0 && styles.down,
            ]}
          >
            {formatPercent(coin.change24h)} (24h)
          </Text>
          <View style={styles.chart}>
            <Sparkline points={coin.sparkline} width={320} height={72} />
          </View>
          <Text style={styles.meta}>Market cap {formatCompactUsd(coin.marketCap)}</Text>
          <Text style={styles.meta}>24h volume {formatCompactUsd(coin.volume24h)}</Text>
          {coin.description ? (
            <Text style={styles.copy} numberOfLines={8}>
              {coin.description}
            </Text>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
