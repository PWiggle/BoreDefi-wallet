import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { WebView } from 'react-native-webview';
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

import { Button } from '../components/Button';
import { CoinGeckoWebEmbed } from '../components/CoinGeckoWebEmbed';
import { ErrorBanner } from '../components/ErrorBanner';
import { InAppBrowserView } from '../components/InAppBrowserView';
import { useWalletConnect } from '../context/WalletConnectContext';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { colors, radius, spacing } from '../theme';
import { classifyBrowserMethod, DAPP_BOOKMARKS, DEFAULT_BROWSER_URL, normalizeDappUrl } from '../wallet/dapps';
import { isCoinGeckoUrl } from '../wallet/markets';
import {
  chainIdHex,
  INJECTED_PROVIDER_SOURCE,
  providerEmitScript,
  providerResolveScript,
  providerSyncScript,
} from '../wallet/injected-provider';
import { sendRpc } from '../wallet/rpc';
import { parseSwitchChainId } from '../wallet/wc';
import { handleWalletConnectRequest } from '../wallet/wc-sign';

function confirmAction(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Reject', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Approve', onPress: () => resolve(true) },
    ]);
  });
}

export function BrowserScreen() {
  const route = useRoute<RouteProp<MainStackParamList, 'Browser'>>();
  const { session, selectedChain, setSelectedChain } = useWallet();
  const { pair } = useWalletConnect();
  const webRef = useRef<WebView>(null);
  const startUrl = route.params?.url ?? DEFAULT_BROWSER_URL;
  const [draft, setDraft] = useState(startUrl);
  const [url, setUrl] = useState(startUrl);
  const [connectedOrigin, setConnectedOrigin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((raw: string) => {
    setError(null);
    try {
      const next = normalizeDappUrl(raw);
      if (next.startsWith('wc:')) {
        pair(next).catch((err) =>
          setError(err instanceof Error ? err.message : 'WalletConnect pair failed.'),
        );
        return;
      }
      setUrl(next);
      setDraft(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid URL.');
    }
  }, [pair]);

  useEffect(() => {
    webRef.current?.injectJavaScript(
      providerSyncScript(session?.address ?? '', selectedChain.id) +
        providerEmitScript('chainChanged', chainIdHex(selectedChain.id)),
    );
  }, [selectedChain.id, session?.address]);

  useFocusEffect(
    useCallback(() => {
      if (route.params?.url) {
        open(route.params.url);
      }
    }, [open, route.params?.url]),
  );

  if (!session) {
    return null;
  }

  const resolve = (id: number, result: unknown, err?: string) => {
    webRef.current?.injectJavaScript(providerResolveScript(id, result, err));
  };

  const onMessage = async (event: WebViewMessageEvent) => {
    let id = 0;
    try {
      const parsed = JSON.parse(event.nativeEvent.data) as {
        id: number;
        payload?: { method?: string; params?: unknown[] };
      };
      id = parsed.id;
      const method = parsed.payload?.method ?? '';
      const params = parsed.payload?.params ?? [];
      const kind = classifyBrowserMethod(method);
      const hex = chainIdHex(selectedChain.id);

      if (kind === 'accounts') {
        resolve(id, connectedOrigin ? [session.address] : []);
        return;
      }
      if (kind === 'local') {
        if (method === 'eth_chainId') {
          resolve(id, hex);
        } else if (method === 'net_version') {
          resolve(id, String(selectedChain.id));
        } else {
          resolve(id, {});
        }
        return;
      }
      if (kind === 'connect') {
        const approved = await confirmAction(
          'Connect wallet',
          `Share ${session.address} with this site? Keys stay on this device.`,
        );
        if (!approved) {
          resolve(id, null, 'User rejected.');
          return;
        }
        setConnectedOrigin(url);
        webRef.current?.injectJavaScript(providerSyncScript(session.address, selectedChain.id));
        webRef.current?.injectJavaScript(
          providerEmitScript('accountsChanged', [session.address]),
        );
        resolve(
          id,
          method === 'wallet_requestPermissions'
            ? [{ parentCapability: 'eth_accounts' }]
            : [session.address],
        );
        return;
      }
      if (kind === 'read') {
        const result = await sendRpc(selectedChain.id, method, params);
        resolve(id, result);
        return;
      }
      if (kind === 'switch') {
        const next = parseSwitchChainId(params);
        if (!next) {
          resolve(id, null, 'That chain is not supported.');
          return;
        }
        const approved = await confirmAction('Switch network', `Switch this wallet to chain ${next}?`);
        if (!approved) {
          resolve(id, null, 'User rejected.');
          return;
        }
        await setSelectedChain(next);
        webRef.current?.injectJavaScript(providerEmitScript('chainChanged', chainIdHex(next)));
        resolve(id, null);
        return;
      }
      if (kind === 'sign') {
        const approved = await confirmAction(
          'Approve request',
          `${method} from this page. Review it before signing.`,
        );
        if (!approved) {
          resolve(id, null, 'User rejected.');
          return;
        }
        const result = await handleWalletConnectRequest({
          mnemonic: session.mnemonic,
          address: session.address,
          method,
          params,
          chainId: selectedChain.id,
        });
        if (result.kind === 'switch') {
          await setSelectedChain(result.chainId);
          webRef.current?.injectJavaScript(
            providerEmitScript('chainChanged', chainIdHex(result.chainId)),
          );
          resolve(id, null);
          return;
        }
        resolve(id, result.value);
        return;
      }
      resolve(id, null, `Method ${method} is not supported.`);
    } catch (err) {
      resolve(id, null, err instanceof Error ? err.message : 'Request failed.');
    }
  };

  const intercept = (request: WebViewNavigation) => {
    if (request.url.startsWith('wc:')) {
      pair(request.url).catch((err) =>
        setError(err instanceof Error ? err.message : 'WalletConnect pair failed.'),
      );
      return false;
    }
    return true;
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Browser</Text>
      <Text style={styles.copy}>
        Injected EIP-1193 provider for WalletConnect-compatible dApps. This is not a Chrome
        extension.
      </Text>
      {error ? <ErrorBanner message={error} /> : null}
      <View style={styles.bar}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https:// or wc:"
          placeholderTextColor={colors.muted}
          style={styles.input}
          onSubmitEditing={() => open(draft)}
        />
        <Button label="Go" onPress={() => open(draft)} style={styles.go} />
      </View>
      <View style={styles.bookmarks}>
        {DAPP_BOOKMARKS.map((item) => (
          <Pressable key={item.url} onPress={() => open(item.url)} style={styles.chip}>
            <Text style={styles.chipText}>{item.name}</Text>
          </Pressable>
        ))}
      </View>
      {Platform.OS === 'web' && isCoinGeckoUrl(url) ? (
        <View style={styles.web}>
          <CoinGeckoWebEmbed url={url} onOpenUrl={open} />
        </View>
      ) : (
        <InAppBrowserView
          ref={webRef}
          uri={url}
          style={styles.web}
          injectedJavaScriptBeforeContentLoaded={INJECTED_PROVIDER_SOURCE}
          onLoadEnd={() => {
            webRef.current?.injectJavaScript(providerSyncScript(session.address, selectedChain.id));
          }}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={intercept}
          onError={(message) => setError(message)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.bg,
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  copy: { color: colors.muted, marginBottom: spacing.sm, marginTop: spacing.xs },
  bar: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  go: { minWidth: 72 },
  bookmarks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipText: { color: colors.text, fontWeight: '700' },
  web: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    marginBottom: spacing.md,
  },
});
