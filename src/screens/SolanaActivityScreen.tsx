import { useCallback, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { formatTimestamp, shortenAddress } from '../wallet/format';
import { fetchSolanaActivity, solanaActivityHiddenReason, splitSolanaActivity, type SolanaActivityItem } from '../wallet/solana/activity';
import { SOLANA_CLUSTER } from '../wallet/solana/config';
import { formatSol, formatSolanaAmount } from '../wallet/solana/format';

function activityStyles({ colors, card, type }: Theme) {
  return {
    item: { ...card, gap: 2 },
    top: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
    dir: type.label,
    failed: { ...type.label, color: colors.danger },
    amt: { color: colors.text, fontWeight: '700' as const },
    meta: type.meta,
    link: { color: colors.accent, fontSize: 13, fontWeight: '700' as const },
    empty: { color: colors.muted },
  };
}

export function directionLabel(item: SolanaActivityItem): string {
  if (item.status === 'failed') return 'Failed';
  return item.direction === 'in' ? 'Received' : item.direction === 'out' ? 'Sent' : 'Account update';
}

export function SolanaActivityScreen() {
  const styles = useThemedStyles(activityStyles);
  const { solanaAddress, settings } = useWallet();
  const [items, setItems] = useState<SolanaActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const load = useCallback(async () => {
    if (!solanaAddress) return;
    setError(null);
    try {
      setItems(await fetchSolanaActivity(solanaAddress));
    } catch {
      setError('Could not load Solana activity. Pull to refresh.');
    }
  }, [solanaAddress]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const hide = settings.hideBalances;
  const { shown, hidden } = splitSolanaActivity(items ?? []);
  const rows = showHidden ? [...shown, ...hidden] : shown;
  return (
    <Screen
      title="Solana activity"
      subtitle={SOLANA_CLUSTER === 'devnet' ? 'Solana devnet' : 'Solana'}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      <ErrorBanner message={error} />
      {items === null && !error ? <Text style={styles.empty}>Loading…</Text> : null}
      {items?.length === 0 ? <Text style={styles.empty}>No Solana transactions yet.</Text> : null}
      {hidden.length > 0 ? (
        <Pressable onPress={() => setShowHidden((v) => !v)} style={styles.item}>
          <Text style={styles.meta}>
            {showHidden ? 'Hide' : 'Show hidden'} ({hidden.length}): spam, dust and failed transactions. Never copy an address from these.
          </Text>
        </Pressable>
      ) : null}
      {rows.map((item) => (
        <Pressable key={item.signature} style={styles.item} onPress={() => Linking.openURL(item.explorerUrl)}>
          <View style={styles.top}>
            <Text style={item.status === 'failed' ? styles.failed : styles.dir}>{directionLabel(item)}</Text>
            <Text style={styles.link}>Solscan ↗</Text>
          </View>
          {item.amount > 0n ? (
            <Text style={styles.amt}>
              {item.direction === 'in' ? '+' : item.direction === 'out' ? '−' : ''}
              {hide ? '••••' : formatSolanaAmount(item.amount, item.decimals)} {item.symbol}
            </Text>
          ) : null}
          {solanaActivityHiddenReason(item) ? <Text style={styles.meta}>{solanaActivityHiddenReason(item)}</Text> : null}
          <Text style={styles.meta}>
            {item.blockTime ? formatTimestamp(item.blockTime) : 'Pending'}
            {item.counterparty ? ` · ${item.direction === 'in' ? 'from' : 'to'} ${shortenAddress(item.counterparty)}` : ''}
            {item.feeLamports > 0n ? ` · fee ${formatSol(item.feeLamports)} SOL` : ''}
          </Text>
        </Pressable>
      ))}
    </Screen>
  );
}
