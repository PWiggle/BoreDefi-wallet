import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { WebView } from 'react-native-webview';
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

import { Button } from '../components/Button';
import { CoinGeckoWebEmbed } from '../components/CoinGeckoWebEmbed';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ErrorBanner } from '../components/ErrorBanner';
import { InAppBrowserView } from '../components/InAppBrowserView';
import { useWalletConnect } from '../context/WalletConnectContext';
import { useWallet } from '../context/WalletContext';
import type { MainTabParamList } from '../navigation';
import { colors, field, radius, spacing, type } from '../theme';
import { classifyBrowserMethod, DAPP_BOOKMARKS, DEFAULT_BROWSER_URL, normalizeDappUrl } from '../wallet/dapps';
import { isCoinGeckoUrl } from '../wallet/markets';
import {
  chainIdHex,
  INJECTED_PROVIDER_SOURCE,
  providerEmitScript,
  providerResolveScript,
  providerSyncScript,
} from '../wallet/injected-provider';
import { inspectDappApproval } from '../wallet/approval-risk';
import { formatNative } from '../wallet/format';
import { sendRpc } from '../wallet/rpc';
import { parseSwitchChainId } from '../wallet/wc';
import { handleWalletConnectRequest } from '../wallet/wc-sign';

type BrowserConfirm = {
  title: string;
  network: string;
  from?: string;
  to?: string;
  amount?: string;
  fee?: string;
  extra?: { label: string; value: string }[];
  mode: 'hold' | 'buttons';
  confirmLabel?: string;
  cancelLabel?: string;
  warnings?: string[];
  danger?: boolean;
  resolve: (ok: boolean) => void;
};

function txAmount(value: unknown, symbol: string): string | undefined {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  try {
    return `${formatNative(BigInt(value))} ${symbol}`;
  } catch {
    return value;
  }
}

export function BrowserScreen() {
  const route = useRoute<RouteProp<MainTabParamList, 'Browser'>>();
  const { session, selectedChain, setSelectedChain } = useWallet();
  const { pair } = useWalletConnect();
  const webRef = useRef<WebView>(null);
  const startUrl = route.params?.url ?? DEFAULT_BROWSER_URL;
  const [draft, setDraft] = useState(startUrl);
  const [url, setUrl] = useState(startUrl);
  const [connectedOrigin, setConnectedOrigin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<BrowserConfirm | null>(null);

  const requestConfirm = (spec: Omit<BrowserConfirm, 'resolve'>): Promise<boolean> =>
    new Promise((resolve) => {
      setPendingConfirm({ ...spec, resolve });
    });

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
        const approved = await requestConfirm({
          title: 'Connect wallet',
          network: selectedChain.name,
          from: session.address,
          extra: [{ label: 'Site', value: 'Share this public address. Keys stay on this device.' }],
          mode: 'buttons',
          confirmLabel: 'Connect',
        });
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
        const approved = await requestConfirm({
          title: 'Switch network',
          network: selectedChain.name,
          extra: [{ label: 'Next chain', value: String(next) }],
          mode: 'buttons',
          confirmLabel: 'Switch',
        });
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
        const tx = params[0] as { from?: string; to?: string; value?: string; data?: string } | undefined;
        const isSend = method === 'eth_sendTransaction' || method === 'eth_signTransaction';
        const risk = inspectDappApproval(method, params);
        const approved = await requestConfirm({
          title: risk?.danger ? 'Danger: collection-wide approval' : 'Approve request',
          network: selectedChain.name,
          from: tx?.from ?? session.address,
          to: isSend ? tx?.to : undefined,
          amount: risk?.danger
            ? risk.summary
            : isSend
              ? txAmount(tx?.value, selectedChain.symbol) ?? method
              : method,
          fee: isSend ? 'Network gas (quoted at sign)' : 'None (signature only)',
          extra: [
            { label: 'Method', value: method },
            ...(risk?.operator ? [{ label: 'Operator', value: risk.operator }] : []),
            ...(risk?.token ? [{ label: 'Token / collection', value: risk.token }] : []),
          ],
          warnings: risk?.warnings,
          danger: Boolean(risk?.danger),
          mode: 'hold',
          confirmLabel: risk?.danger ? 'Hold to approve anyway' : 'Hold to sign',
          cancelLabel: 'Reject',
        });
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
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.title}>Browser</Text>
      <Text style={styles.copy}>dApps stay in-app. Injected EIP-1193 provider. Not a Chrome extension.</Text>
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
      <ConfirmSheet
        visible={Boolean(pendingConfirm)}
        title={pendingConfirm?.title ?? ''}
        network={pendingConfirm?.network ?? selectedChain.name}
        from={pendingConfirm?.from}
        to={pendingConfirm?.to}
        amount={pendingConfirm?.amount}
        fee={pendingConfirm?.fee}
        extra={pendingConfirm?.extra}
        warnings={pendingConfirm?.warnings}
        variant={pendingConfirm?.danger ? 'danger' : 'default'}
        mode={pendingConfirm?.mode ?? 'hold'}
        confirmLabel={pendingConfirm?.confirmLabel}
        cancelLabel={pendingConfirm?.cancelLabel}
        onConfirm={() => {
          pendingConfirm?.resolve(true);
          setPendingConfirm(null);
        }}
        onCancel={() => {
          pendingConfirm?.resolve(false);
          setPendingConfirm(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.bg,
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  title: type.title,
  copy: { ...type.subtitle, marginBottom: spacing.sm },
  bar: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  input: {
    ...field,
    flex: 1,
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
