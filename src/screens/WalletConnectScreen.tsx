import { useEffect, useRef, useState } from 'react';
import { Image, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWalletConnect } from '../context/WalletConnectContext';
import type { MainStackParamList } from '../navigation';
import { neutralizeUrls } from '../wallet/security/text-safety';
import { extractWalletConnectUri } from '../wallet/wc';

function wcStyles({ colors, card, field, spacing }: Theme) {
  return {
    help: {
      color: colors.muted,
      lineHeight: 20,
    },
    input: field,
    section: {
      color: colors.text,
      fontWeight: '700' as const,
      fontSize: 18,
      marginTop: spacing.sm,
    },
    session: {
      ...card,
      gap: spacing.xs,
    },
    name: {
      color: colors.text,
      fontWeight: '700' as const,
    },
    sessionHead: {
      alignItems: 'center' as const,
      flexDirection: 'row' as const,
      gap: spacing.sm,
    },
    icon: {
      backgroundColor: colors.bg,
      borderRadius: 8,
      height: 32,
      width: 32,
    },
  };
}

export function WalletConnectScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(wcStyles);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'WalletConnect'>>();
  const { projectId, ready, error, sessions, pair, disconnect } = useWalletConnect();
  const [uri, setUri] = useState(route.params?.uri ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoPaired = useRef<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);

  const connect = async (value = uri) => {
    if (!value || !value.trim()) {
      setLocalError(null);
      setNotice('Paste a wc: link from the dApp, or tap Scan QR.');
      return;
    }
    setBusy(true);
    setLocalError(null);
    setNotice(null);
    try {
      await pair(value);
      setUri('');
      setNotice('Paired. Approve the connection when the dApp asks.');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not pair.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const incoming = extractWalletConnectUri(route.params?.uri);
    if (!incoming || !ready || !projectId || autoPaired.current === incoming) {
      return;
    }
    autoPaired.current = incoming;
    setUri(incoming);
    void connect(incoming);
    // Pair once per incoming URI after the relay is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ready, route.params?.uri]);

  return (
    <Screen title="WalletConnect" subtitle="Connect desktop and mobile dApps: scan their QR code or paste their wc: link.">
      <ErrorBanner message={localError ?? error} />
      {!projectId ? (
        <Text style={styles.help}>WalletConnect is not configured in this build.</Text>
      ) : (
        <Text style={styles.help}>
          {ready ? 'Relay is ready. Scan or paste a wc: URI from a dApp.' : 'Starting WalletConnect…'}
        </Text>
      )}
      {notice ? <Text style={styles.help}>{notice}</Text> : null}
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
        label="Paste link"
        variant="secondary"
        disabled={!projectId}
        onPress={async () => {
          const text = await Clipboard.getStringAsync().catch(() => '');
          const pasted = extractWalletConnectUri(text);
          if (!pasted) {
            setLocalError(null);
            setNotice('No WalletConnect link on the clipboard. Copy the wc: link from the dApp first.');
            return;
          }
          setUri(pasted);
          void connect(pasted);
        }}
      />
      <Button
        label="Scan QR"
        variant="secondary"
        onPress={() => navigation.navigate('ScanQr', { purpose: 'walletconnect' })}
      />
      <Text style={styles.section}>Connected apps</Text>
      {sessions.length === 0 ? (
        <Text style={styles.help}>No connected apps.</Text>
      ) : (
        sessions.map((item) => (
          <View key={item.topic} style={styles.session}>
            <View style={styles.sessionHead}>
              {item.icon ? <Image source={{ uri: item.icon }} style={styles.icon} /> : null}
              <Text style={[styles.name, { flex: 1 }]}>{neutralizeUrls(item.name)}</Text>
            </View>
            {item.url ? <Text style={styles.help}>{item.url}</Text> : null}
            {item.chains.length ? <Text style={styles.help}>{item.chains.join(', ')}</Text> : null}
            {item.expiry ? (
              <Text style={styles.help}>Expires {new Date(item.expiry * 1000).toLocaleDateString()}</Text>
            ) : null}
            <Button
              label="Disconnect"
              variant="ghost"
              onPress={() => {
                disconnect(item.topic).catch((err: unknown) =>
                  setLocalError(err instanceof Error ? err.message : 'Could not disconnect.'),
                );
              }}
            />
          </View>
        ))
      )}
    </Screen>
  );
}
