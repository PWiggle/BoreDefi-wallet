import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import type { MainNavigation } from '../navigation';
import { formatUsd, shortenAddress } from '../wallet/format';
import { formatSol, formatSolanaAmount } from '../wallet/solana/format';
import { fetchMarketDetails, indexMarketsById, usdValueFromUnits, type MarketCoin } from '../wallet/markets';
import { SOLANA_CLUSTER } from '../wallet/solana/config';
import { fetchSolanaPortfolio, solanaGeckoIds, type SolanaPortfolio } from '../wallet/solana/portfolio';
import { SOL_DECIMALS, SOL_GECKO_ID } from '../wallet/solana/tokens';

function solStyles({ colors, card, radius, spacing, type }: Theme) {
  return {
    section: { gap: spacing.sm },
    head: { alignItems: 'center' as const, flexDirection: 'row' as const, justifyContent: 'space-between' as const },
    title: { color: colors.text, fontSize: 18, fontWeight: '700' as const },
    link: { color: colors.accent, fontSize: 13, fontWeight: '700' as const },
    card: { ...card, borderRadius: radius.lg, gap: spacing.xs },
    usd: { color: colors.text, fontSize: 24, fontWeight: '800' as const },
    native: { color: colors.muted, fontSize: 14, fontWeight: '600' as const },
    address: { color: colors.accent, fontWeight: '700' as const },
    row: { alignItems: 'center' as const, flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingVertical: 4 },
    sym: { color: colors.text, fontWeight: '700' as const },
    amt: { color: colors.text },
    meta: type.meta,
    actions: { flexDirection: 'row' as const, gap: spacing.sm, marginTop: spacing.xs },
    action: {
      backgroundColor: colors.accentDim,
      borderRadius: radius.pill,
      flex: 1,
      paddingVertical: spacing.sm,
    },
    actionText: { color: colors.accent, fontWeight: '700' as const, textAlign: 'center' as const },
  };
}

/** Home card for the Solana account (rendered only when SOLANA_ENABLED). */
export function SolanaHomeSection() {
  const styles = useThemedStyles(solStyles);
  const navigation = useNavigation<MainNavigation>();
  const { solanaAddress, settings } = useWallet();
  const [portfolio, setPortfolio] = useState<SolanaPortfolio | null>(null);
  const [prices, setPrices] = useState<Map<string, MarketCoin>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!solanaAddress) {
      return;
    }
    setError(null);
    try {
      const next = await fetchSolanaPortfolio(solanaAddress);
      setPortfolio(next);
      const markets = await fetchMarketDetails(solanaGeckoIds(next)).catch(() => [] as MarketCoin[]);
      setPrices(indexMarketsById(markets));
    } catch {
      setError('Could not load your Solana balance. Pull to refresh.');
    }
  }, [solanaAddress]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!solanaAddress) {
    return null;
  }
  const hide = settings.hideBalances;
  const solUsd = portfolio ? usdValueFromUnits(portfolio.sol, SOL_DECIMALS, prices.get(SOL_GECKO_ID)?.priceUsd) : null;
  const tokenUsd = (portfolio?.tokens ?? []).map((row) => usdValueFromUnits(row.amount, row.decimals, row.geckoId ? prices.get(row.geckoId)?.priceUsd : null));
  const total = solUsd === null ? null : tokenUsd.reduce<number>((sum, value) => sum + (value ?? 0), solUsd);

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={styles.title}>Solana{SOLANA_CLUSTER === 'devnet' ? ' (devnet)' : ''}</Text>
        <Pressable onPress={load}>
          <Text style={styles.link}>Refresh</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.usd}>{hide ? '••••' : formatUsd(total)}</Text>
        <Text style={styles.native}>
          {hide ? '••••' : portfolio ? formatSol(portfolio.sol) : '—'} SOL
        </Text>
        <Pressable
          onPress={async () => {
            await Clipboard.setStringAsync(solanaAddress);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Text style={styles.address}>{copied ? 'Copied' : shortenAddress(solanaAddress)}</Text>
        </Pressable>
        {(portfolio?.tokens ?? []).map((row, index) => (
          <Pressable key={row.mint} style={styles.row} onPress={() => navigation.navigate('SolanaSend', { mint: row.mint })}>
            <Text style={styles.sym}>{row.symbol}</Text>
            <Text style={styles.amt}>
              {hide ? '••••' : `${formatSolanaAmount(row.amount, row.decimals)} · ${formatUsd(tokenUsd[index] ?? null)}`}
            </Text>
          </Pressable>
        ))}
        {portfolio && portfolio.hiddenCount > 0 ? (
          <Text style={styles.meta}>
            {portfolio.hiddenCount} unknown token{portfolio.hiddenCount === 1 ? '' : 's'} hidden (possible spam).
          </Text>
        ) : null}
        {error ? <Text style={styles.meta}>{error}</Text> : null}
        <View style={styles.actions}>
          <Pressable style={styles.action} onPress={() => navigation.navigate('SolanaSend', {})}>
            <Text style={styles.actionText}>Send</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => navigation.navigate('SolanaReceive')}>
            <Text style={styles.actionText}>Receive</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => navigation.navigate('SolanaSwap', {})}>
            <Text style={styles.actionText}>Swap</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => navigation.navigate('SolanaActivity')}>
            <Text style={styles.actionText}>Activity</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
