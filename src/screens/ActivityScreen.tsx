import { useCallback, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { fetchActivity, type ActivityItem } from '../wallet/activity';
import { formatNative, formatTimestamp, shortenAddress } from '../wallet/format';

function activityStyles({ colors, type, card, spacing }: Theme) {
  return {
    empty: type.meta,
    row: {
      ...card,
      gap: 4,
    },
    rowTop: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      gap: spacing.md,
    },
    dir: {
      color: colors.muted,
      textTransform: 'uppercase' as const,
      fontSize: 12,
      fontWeight: '700' as const,
    },
    amt: {
      color: colors.text,
      fontWeight: '700' as const,
    },
    failed: {
      color: colors.danger,
      textDecorationLine: 'line-through' as const,
    },
    meta: {
      color: colors.muted,
      fontSize: 13,
    },
  };
}

export function ActivityScreen() {
  const styles = useThemedStyles(activityStyles);
  const { session, selectedChain } = useWallet();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    try {
      setError(null);
      setItems(await fetchActivity(session.address, selectedChain.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load activity.');
    }
  }, [selectedChain.id, session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen title="Activity" subtitle={selectedChain.name}>
      <ErrorBanner message={error} />
      {items.length === 0 && !error ? (
        <Text style={styles.empty}>No transactions found on this network.</Text>
      ) : null}
      {items.map((item) => (
        <Pressable
          key={item.hash}
          style={styles.row}
          onPress={() => Linking.openURL(`${selectedChain.explorerTx}${item.hash}`)}
        >
          <View style={styles.rowTop}>
            <Text style={styles.dir}>{item.inbound ? 'Received' : 'Sent'}</Text>
            <Text style={[styles.amt, item.status === 'failed' && styles.failed]}>
              {item.inbound ? '+' : '−'}
              {formatNative(item.valueWei)} {selectedChain.symbol}
            </Text>
          </View>
          <Text style={styles.meta}>
            {item.inbound ? 'From' : 'To'} {shortenAddress(item.inbound ? item.from : item.to)}
          </Text>
          <Text style={styles.meta}>{formatTimestamp(item.timestamp)}</Text>
        </Pressable>
      ))}
    </Screen>
  );
}
