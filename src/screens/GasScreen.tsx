import { useEffect, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { Screen } from '../components/Screen';
import { useGas } from '../components/useGas';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import {
  chartPath,
  formatGwei,
  formatUsdFee,
  gasCostUsd,
  gasLevel,
  TYPICAL_ACTIONS,
  type GasHistory,
  type GasSnapshot,
} from '../wallet/gas';

function gasStyles({ colors, card, radius, spacing, type }: Theme) {
  return {
    card: { ...card, gap: spacing.sm },
    label: type.label,
    meta: type.meta,
    hero: { alignItems: 'flex-end' as const, flexDirection: 'row' as const, gap: 8 },
    heroValue: { color: colors.text, fontSize: 44, fontWeight: '900' as const, letterSpacing: -1 },
    heroUnit: { color: colors.muted, fontSize: 18, fontWeight: '700' as const, paddingBottom: 8 },
    level: { fontSize: 14, fontWeight: '800' as const },
    tiers: { flexDirection: 'row' as const, gap: spacing.sm },
    tier: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flex: 1,
      gap: 2,
      padding: spacing.sm,
    },
    tierOn: { borderColor: colors.accent },
    tierName: { ...type.label, fontSize: 11 },
    tierGwei: { color: colors.text, fontSize: 20, fontWeight: '900' as const },
    tierSub: { color: colors.muted, fontSize: 12 },
    row: { alignItems: 'center' as const, borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row' as const, paddingVertical: 8 },
    rowLast: { borderBottomWidth: 0 },
    cell: { color: colors.text, flex: 1, fontSize: 14, textAlign: 'right' as const },
    cellName: { color: colors.text, flex: 1.6, fontSize: 14, fontWeight: '700' as const },
    head: { color: colors.muted, flex: 1, fontSize: 11, fontWeight: '800' as const, textAlign: 'right' as const },
    headName: { color: colors.muted, flex: 1.6, fontSize: 11, fontWeight: '800' as const },
    axis: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
    title: { color: colors.text, fontSize: 18, fontWeight: '800' as const },
  };
}

function useAgo(updatedAt: number | undefined): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!updatedAt) {
    return '';
  }
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)} min ago`;
}

export function GasScreen() {
  const styles = useThemedStyles(gasStyles);
  const { colors } = useTheme();
  const { snapshot, history, error } = useGas({ history: true });
  const ago = useAgo(snapshot?.updatedAt);
  return (
    <Screen title="Gas tracker" subtitle="Ethereum gas right now, in gwei and dollars. Refreshes every 12 seconds.">
      {snapshot ? <GasNow snapshot={snapshot} ago={ago} /> : <Text style={styles.meta}>{error ?? 'Loading live gas…'}</Text>}
      {snapshot ? <GasCosts snapshot={snapshot} /> : null}
      <GasChart history={history} current={snapshot?.average.gwei ?? null} />
      {snapshot?.apeChain ? <ApeChainGas snapshot={snapshot} /> : null}
      <Text style={styles.meta}>
        {`Source: ${snapshot?.source === 'rpc' ? 'public Ethereum RPCs (direct)' : 'boredefi.com gas API'} · free public data, no account needed.`}
      </Text>
      {error && snapshot ? <Text style={[styles.meta, { color: colors.warning }]}>{error}</Text> : null}
    </Screen>
  );
}

function GasNow({ snapshot, ago }: { snapshot: GasSnapshot; ago: string }) {
  const styles = useThemedStyles(gasStyles);
  const { colors } = useTheme();
  const level = gasLevel(snapshot.average.gwei);
  const tone = level.tone === 'good' ? colors.accent : level.tone === 'ok' ? colors.warning : colors.danger;
  const send = (gwei: number) => formatUsdFee(gasCostUsd(21_000, gwei, snapshot.ethUsd));
  const tiers = [
    { name: 'Low', tier: snapshot.low, note: '~1 min+' },
    { name: 'Average', tier: snapshot.average, note: '~30 s' },
    { name: 'Fast', tier: snapshot.fast, note: 'next block' },
  ];
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Average now</Text>
      <View style={styles.hero}>
        <Text style={styles.heroValue}>{formatGwei(snapshot.average.gwei)}</Text>
        <Text style={styles.heroUnit}>gwei</Text>
      </View>
      <Text style={[styles.level, { color: tone }]}>{level.label}</Text>
      <View style={styles.tiers}>
        {tiers.map((item) => (
          <View key={item.name} style={[styles.tier, item.name === 'Average' && styles.tierOn]}>
            <Text style={styles.tierName}>{item.name}</Text>
            <Text style={styles.tierGwei}>{formatGwei(item.tier.gwei)}</Text>
            <Text style={styles.tierSub}>{`Send ${send(item.tier.gwei)}`}</Text>
            <Text style={styles.tierSub}>{item.note}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.meta}>
        {`Base fee ${formatGwei(snapshot.baseFeeGwei)} gwei${snapshot.latestBlock ? ` · block ${snapshot.latestBlock.toLocaleString('en-US')}` : ''}${snapshot.ethUsd ? ` · ETH $${snapshot.ethUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : ''} · updated ${ago}`}
      </Text>
    </View>
  );
}

function GasCosts({ snapshot }: { snapshot: GasSnapshot }) {
  const styles = useThemedStyles(gasStyles);
  const cost = (gas: number, gwei: number) => formatUsdFee(gasCostUsd(gas, gwei, snapshot.ethUsd));
  return (
    <View style={styles.card}>
      <Text style={styles.title}>What it costs now</Text>
      <View style={styles.row}>
        <Text style={styles.headName}>ACTION</Text>
        <Text style={styles.head}>LOW</Text>
        <Text style={styles.head}>AVERAGE</Text>
        <Text style={styles.head}>FAST</Text>
      </View>
      {TYPICAL_ACTIONS.map((action, index) => (
        <View key={action.key} style={[styles.row, index === TYPICAL_ACTIONS.length - 1 && styles.rowLast]}>
          <Text style={styles.cellName}>{action.label}</Text>
          <Text style={styles.cell}>{cost(action.gas, snapshot.low.gwei)}</Text>
          <Text style={styles.cell}>{cost(action.gas, snapshot.average.gwei)}</Text>
          <Text style={styles.cell}>{cost(action.gas, snapshot.fast.gwei)}</Text>
        </View>
      ))}
      <Text style={styles.meta}>Typical gas: send 21k, token 65k, NFT 85k, swap 180k. Real swaps vary by route.</Text>
    </View>
  );
}

function GasChart({ history, current }: { history: GasHistory | null; current: number | null }) {
  const styles = useThemedStyles(gasStyles);
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(200, Math.min(width, 430) - 64);
  const height = 140;
  if (!history) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Last 24 hours</Text>
        <Text style={styles.meta}>Loading the 24-hour chart…</Text>
      </View>
    );
  }
  const { line, area, min, max } = chartPath(history.points, chartWidth, height);
  const avg = history.points.reduce((sum, point) => sum + point.avgGwei, 0) / history.points.length;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Last 24 hours</Text>
      <Text style={styles.meta}>{`Base fee, average per ~30 min · low ${formatGwei(min)} · high ${formatGwei(max)} · 24h avg ${formatGwei(avg)} gwei`}</Text>
      <Svg width={chartWidth} height={height}>
        <Defs>
          <LinearGradient id="gasFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.accent} stopOpacity="0.35" />
            <Stop offset="1" stopColor={colors.accent} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d={area} fill="url(#gasFill)" />
        <Path d={line} stroke={colors.accent} strokeWidth={2} fill="none" />
      </Svg>
      <View style={styles.axis}>
        <Text style={styles.meta}>{`${Math.round(history.coveredHours)}h ago`}</Text>
        <Text style={styles.meta}>{current !== null ? `now ${formatGwei(current)} gwei` : 'now'}</Text>
      </View>
    </View>
  );
}

function ApeChainGas({ snapshot }: { snapshot: GasSnapshot }) {
  const styles = useThemedStyles(gasStyles);
  const ape = snapshot.apeChain!;
  const cost = (gas: number) => formatUsdFee(gasCostUsd(gas, ape.gasPriceGwei, ape.apeUsd));
  return (
    <View style={styles.card}>
      <Text style={styles.title}>ApeChain</Text>
      <View style={styles.hero}>
        <Text style={[styles.heroValue, { fontSize: 32 }]}>{formatGwei(ape.gasPriceGwei)}</Text>
        <Text style={styles.heroUnit}>gwei (paid in APE)</Text>
      </View>
      <Text style={styles.meta}>
        {`Send APE ${cost(21_000)} · token ${cost(65_000)} · NFT ${cost(85_000)} · swap ${cost(180_000)}${ape.apeUsd ? ` · APE $${ape.apeUsd.toFixed(4)}` : ''}`}
      </Text>
    </View>
  );
}

/** One-line gas card for Home: live average gwei + send cost; tap opens the Gas screen. */
export function GasSummary({ snapshot }: { snapshot: GasSnapshot | null }) {
  const styles = useThemedStyles(gasStyles);
  if (!snapshot) {
    return <Text style={styles.meta}>Gas: loading…</Text>;
  }
  return (
    <Text style={styles.meta}>
      {`${formatGwei(snapshot.average.gwei)} gwei · send ${formatUsdFee(gasCostUsd(21_000, snapshot.average.gwei, snapshot.ethUsd))} · swap ${formatUsdFee(gasCostUsd(180_000, snapshot.average.gwei, snapshot.ethUsd))}`}
    </Text>
  );
}
