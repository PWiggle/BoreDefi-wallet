import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useWalletConnect } from '../context/WalletConnectContext';
import type { MainStackParamList } from '../navigation';
import { card, colors, field, spacing } from '../theme';

export function WalletConnectScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'WalletConnect'>>();
  const { projectId, ready, error, sessions, pair, disconnect } = useWalletConnect();
  const [uri, setUri] = useState(route.params?.uri ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async (value = uri) => {
    setBusy(true);
    setLocalError(null);
    try {
      await pair(value);
      setUri('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not pair.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="WalletConnect" subtitle="Pair a dApp with this wallet. Browser tab can also open wc: links.">
      <ErrorBanner message={localError ?? error} />
      {!projectId ? (
        <Text style={styles.help}>
          Create a free project at dashboard.reown.com and set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID
          in a local .env file, then restart Metro. The project ID is a public client identifier, not
          a key that can move funds. Do not commit secrets.
        </Text>
      ) : (
        <Text style={styles.help}>
          {ready ? 'Relay is ready. Scan or paste a wc: URI from a dApp.' : 'Starting WalletConnect…'}
        </Text>
      )}
      <TextInput
        value={uri}
        onChangeText={setUri}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholder="wc:…"
        placeholderTextColor={colors.muted}
        editable={Boolean(projectId)}
      />
      <Button label="Pair" loading={busy} disabled={!projectId} onPress={() => connect()} />
      <Button
        label="Scan QR"
        variant="secondary"
        onPress={() => navigation.navigate('ScanQr', { purpose: 'walletconnect' })}
      />
      <Text style={styles.section}>Sessions</Text>
      {sessions.length === 0 ? (
        <Text style={styles.help}>No connected dApps.</Text>
      ) : (
        sessions.map((item) => (
          <View key={item.topic} style={styles.session}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.help}>{item.url}</Text>
            <Button label="Disconnect" variant="ghost" onPress={() => disconnect(item.topic)} />
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  help: {
    color: colors.muted,
    lineHeight: 20,
  },
  input: field,
  section: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 18,
    marginTop: spacing.sm,
  },
  session: {
    ...card,
    gap: spacing.xs,
  },
  name: {
    color: colors.text,
    fontWeight: '700',
  },
});
