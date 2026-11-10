import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
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
import { ProtectedGuardSheet } from '../components/ProtectedGuardSheet';
import { ErrorBanner } from '../components/ErrorBanner';
import { InAppBrowserView } from '../components/InAppBrowserView';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWalletConnect } from '../context/WalletConnectContext';
import { useWallet } from '../context/WalletContext';
import type { MainTabParamList } from '../navigation';
import {
  classifyBrowserMethod,
  DAPP_BOOKMARKS,
  dappHost,
  dappOrigin,
  DEFAULT_BROWSER_URL,
  normalizeDappUrl,
  urlBarAfterNavigation,
} from '../wallet/dapps';
import { checkPhishing, refreshPhishingList } from '../wallet/security/phishing';
import { claimHandoff, walletLinkSource, walletStoreUrl, type HandoffTarget } from '../wallet/wc-source';
import { CHAINS } from '../wallet/chains';
import { isCoinGeckoUrl } from '../wallet/markets';
import {
  blockedSchemeMessage,
  type BrowserNavDecision,
  classifyBrowserNavigation,
  coinbaseDappLink,
  isUnknownSchemeError,
} from '../wallet/browser-nav';
import {
  chainIdHex,
  injectedProviderSource,
  isGestureMessage,
  isOriginConnected,
  parseOpenMessage,
  providerEmitScript,
  providerResolveScript,
  providerSyncScript,
} from '../wallet/injected-provider';
import { inspectDappApproval } from '../wallet/approval-risk';
import { formatNative } from '../wallet/format';
import { sendRpc } from '../wallet/rpc';
import { extractWalletConnectUri, isWalletConnectNavigation, parseSwitchChainId } from '../wallet/wc';
import { handleWalletConnectRequest } from '../wallet/wc-sign';
import type { ProtectedVerdict } from '../wallet/protected-guard';
import { estimateNetworkFee, formatNetworkFee } from '../wallet/network-fee';
import { reviewDappRequest } from '../wallet/request-review';
import type { TxPreview } from '../wallet/tx-simulate';

/**
 * A page may open another wallet's app (or a store page) only this soon after the user touched it.
 * 30s, not 10s: WalletConnect builds the pairing link over the network after the tap, and the
 * WalletConnect wallet list fires the link when the URI arrives, which can take a while on mobile data.
 */
const TAP_WINDOW_MS = 30_000;

/** Per-WebView secret for the injected script's real-tap reports (see injectedProviderSource). */
function newGestureKey(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

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
  preview?: TxPreview | null;
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

function browserStyles({ colors, field, radius, spacing, type }: Theme) {
  return {
    root: {
      backgroundColor: colors.bg,
      flex: 1,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    title: type.title,
    copy: { ...type.subtitle, marginBottom: spacing.sm },
    bar: { flexDirection: 'row' as const, gap: spacing.sm, marginBottom: spacing.sm },
    input: {
      ...field,
      flex: 1,
    },
    go: { minWidth: 72 },
    bookmarks: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm, marginBottom: spacing.sm },
    chip: {
      borderColor: colors.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    chipText: { color: colors.text, fontWeight: '700' as const },
    notice: {
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    noticeText: { color: colors.muted, fontSize: 13, lineHeight: 18 },
    webWrap: { flex: 1 },
    web: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flex: 1,
      marginBottom: spacing.md,
    },
  };
}

export function BrowserScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(browserStyles);
  const route = useRoute<RouteProp<MainTabParamList, 'Browser'>>();
  const { session, selectedChain, setSelectedChain } = useWallet();
  const { pair } = useWalletConnect();
  const webRef = useRef<WebView>(null);
  const startUrl = route.params?.url ?? DEFAULT_BROWSER_URL;
  const [draft, setDraft] = useState(startUrl);
  const [url, setUrl] = useState(startUrl);
  // The page actually loaded (follows redirects). Origins on prompts come from here, never from the typed URL.
  const [pageUrl, setPageUrl] = useState(startUrl);
  const editingRef = useRef(false);
  // DO NOT REVERT to reading connection state from a render closure. On iOS the page's
  // follow-up eth_accounts arrives before React re-renders after Connect is approved, so the
  // old onMessage closure answered [] -> the Connect page reset itself and crashed with
  // "null is not an object (evaluating 'provider.request')". The ref is updated synchronously.
  const connectedOriginRef = useRef<string | null>(null);
  const setConnectedOrigin = useCallback((next: string | null) => {
    connectedOriginRef.current = next;
  }, []);
  const [error, setError] = useState<string | null>(null);
  // Small, self-clearing note (not an error) for app links a page tried to open.
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped to remount the WebView on the last good page after a failed app-link load.
  const [webKey, setWebKey] = useState(0);
  const lastPairRef = useRef<{ uri: string; at: number } | null>(null);
  const lastExternalRef = useRef<{ url: string; at: number } | null>(null);
  // Pairing topic -> where that link went (BoreDefi or another wallet). One link, one wallet.
  const handoffsRef = useRef(new Map<string, HandoffTarget>());
  // Last time the user touched the page (native touch, the page can't fake it). Other wallets'
  // links only go to the OS shortly after a real tap, like Safari, so pages can't drive-by launch apps.
  const lastTouchRef = useRef(0);
  const gestureKeyRef = useRef<string>('');
  if (!gestureKeyRef.current) {
    gestureKeyRef.current = newGestureKey();
  }
  const injectedSourceRef = useRef<string>('');
  if (!injectedSourceRef.current) {
    injectedSourceRef.current = injectedProviderSource(gestureKeyRef.current);
  }
  const [pendingConfirm, setPendingConfirm] = useState<BrowserConfirm | null>(null);

  const [pendingProtected, setPendingProtected] = useState<{
    verdict: ProtectedVerdict;
    site: string;
    preview: TxPreview | null;
    resolve: (clearance: string | null) => void;
  } | null>(null);

  const requestProtected = (verdict: ProtectedVerdict, site: string, preview: TxPreview | null): Promise<string | null> =>
    new Promise((resolve) => {
      setPendingProtected({ verdict, site, preview, resolve });
    });

  const requestConfirm = (spec: Omit<BrowserConfirm, 'resolve'>): Promise<boolean> =>
    new Promise((resolve) => {
      setPendingConfirm({ ...spec, resolve });
    });

  const open = useCallback((raw: string) => {
    setError(null);
    try {
      // Pasted pairing links in any wrapper (WC:, wc%3A, boredefi://wc?uri=, metamask://wc?uri=).
      const pasted = /^\s*https?:/i.test(raw) ? null : extractWalletConnectUri(raw);
      const next = pasted ?? normalizeDappUrl(raw);
      const verdict = next.startsWith('wc:') ? null : checkPhishing(next);
      if (verdict?.blocked) {
        setError(`Blocked: ${verdict.reason} Your wallet was not connected.`);
        return;
      }
      if (next.startsWith('wc:')) {
        pair(next, { sourceWallet: walletLinkSource(raw) }).catch((err) =>
          setError(err instanceof Error ? err.message : 'WalletConnect pair failed.'),
        );
        return;
      }
      setUrl(next);
      setDraft(next);
      setPageUrl(next);
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

  useEffect(() => {
    void refreshPhishingList();
  }, []);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

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
    if (isGestureMessage(event.nativeEvent.data, gestureKeyRef.current)) {
      // A real tap inside the page (the native onTouchStart below doesn't always fire over WKWebView).
      lastTouchRef.current = Date.now();
      return;
    }
    const openUrl = parseOpenMessage(event.nativeEvent.data);
    if (openUrl !== null) {
      // window.open / link click to an app scheme, caught by the injected script.
      if (checkPhishing(event.nativeEvent.url || pageUrl).blocked) {
        return;
      }
      handleAppLink(openUrl);
      return;
    }
    try {
      const parsed = JSON.parse(event.nativeEvent.data) as {
        id: number;
        payload?: { method?: string; params?: unknown[] };
      };
      id = parsed.id;
      // Origin of the frame that sent this request (falls back to the last navigated page, never the typed URL).
      const origin = dappOrigin(event.nativeEvent.url) ?? dappOrigin(pageUrl);
      const site = dappHost(event.nativeEvent.url) ?? dappHost(pageUrl) ?? 'Unknown site';
      const isConnected = isOriginConnected(connectedOriginRef.current, origin);
      const method = parsed.payload?.method ?? '';
      const params = parsed.payload?.params ?? [];
      const kind = classifyBrowserMethod(method);
      const hex = chainIdHex(selectedChain.id);
      const phishing = checkPhishing(event.nativeEvent.url || pageUrl);
      if (phishing.blocked && kind !== 'local') {
        // Never connect to or sign for a blocked site, even if it loaded inside a frame.
        setError(`Blocked: ${phishing.reason} Your wallet was not connected.`);
        resolve(id, kind === 'accounts' ? [] : null, kind === 'accounts' ? undefined : 'Blocked by BoreDefi phishing protection.');
        return;
      }

      if (kind === 'accounts') {
        resolve(id, isConnected ? [session.address] : []);
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
        if (isConnected) {
          // Already approved for this origin (RainbowKit/wagmi send wallet_requestPermissions and then
          // eth_requestAccounts back to back): answer without a second Connect sheet.
          resolve(
            id,
            method === 'wallet_requestPermissions'
              ? [{ parentCapability: 'eth_accounts' }]
              : [session.address],
          );
          return;
        }
        const approved = await requestConfirm({
          title: 'Connect wallet',
          network: selectedChain.name,
          from: session.address,
          extra: [
            { label: 'Site', value: site },
            { label: 'Shares', value: 'This public address. Keys stay on this device.' },
          ],
          mode: 'buttons',
          confirmLabel: 'Connect',
        });
        if (!approved) {
          resolve(id, null, 'User rejected.');
          return;
        }
        if (!origin) {
          resolve(id, null, 'This page has no web origin to connect.');
          return;
        }
        setConnectedOrigin(origin);
        webRef.current?.injectJavaScript(providerSyncScript(session.address, selectedChain.id));
        // Answer the request before announcing accountsChanged so pages see one consistent state.
        resolve(
          id,
          method === 'wallet_requestPermissions'
            ? [{ parentCapability: 'eth_accounts' }]
            : [session.address],
        );
        webRef.current?.injectJavaScript(
          providerEmitScript('accountsChanged', [session.address]),
        );
        return;
      }
      if (kind === 'disconnect') {
        setConnectedOrigin(null);
        webRef.current?.injectJavaScript(providerEmitScript('accountsChanged', []));
        resolve(id, null);
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
          extra: [{ label: 'Next chain', value: CHAINS[next].name }],
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
        if (!isConnected) {
          resolve(id, null, 'Connect this site to the wallet first.');
          return;
        }
        const tx = params[0] as { from?: string; to?: string; value?: string; data?: string } | undefined;
        const isSend = method === 'eth_sendTransaction' || method === 'eth_signTransaction';
        // Transaction preview: simulate before anything is shown, then the protected guard with its findings.
        const { verdict, preview } = await reviewDappRequest({
          method,
          params,
          chainId: selectedChain.id,
          owner: session.address,
        });
        let clearance: string | null = null;
        if (verdict?.protected) {
          clearance = await requestProtected(verdict, site, preview);
          if (!clearance) {
            resolve(id, null, 'User rejected.');
            return;
          }
        }
        const risk = inspectDappApproval(method, params);
        const networkFee = isSend && preview.gasUsed ? await estimateNetworkFee(selectedChain.id, preview.gasUsed) : null;
        const approved = clearance !== null || await requestConfirm({
          title: risk?.danger ? 'Danger: collection-wide approval' : 'Approve request',
          network: selectedChain.name,
          from: tx?.from ?? session.address,
          to: isSend ? tx?.to : undefined,
          amount: risk?.danger
            ? risk.summary
            : isSend
              ? txAmount(tx?.value, selectedChain.symbol) ?? method
              : method,
          fee: isSend ? (networkFee ? formatNetworkFee(networkFee) : 'Network gas (quoted at sign)') : 'None (signature only)',
          preview,
          extra: [
            { label: 'Site', value: site },
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
          clearance,
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

  const pairFromPage = (wcUri: string, sourceWallet: string | null) => {
    // A page can fire the same link twice (window.open plus a redirect); pair it once.
    const now = Date.now();
    const last = lastPairRef.current;
    if (last && last.uri === wcUri && now - last.at < 5000) {
      return;
    }
    lastPairRef.current = { uri: wcUri, at: now };
    if (!claimHandoff(handoffsRef.current, wcUri, 'boredefi')) {
      setNotice('That link was already handed to another wallet, so BoreDefi did not connect. Pick BoreDefi on the site to get a fresh link.');
      return;
    }
    setNotice(
      sourceWallet
        ? `You picked ${sourceWallet} on this site. BoreDefi will connect your BoreDefi wallet instead. Review it before you approve.`
        : 'Opening WalletConnect in BoreDefi. Review the request before you approve it.',
    );
    pair(wcUri, { sourceWallet }).catch((err) =>
      setError(err instanceof Error ? err.message : 'WalletConnect pair failed.'),
    );
  };

  /**
   * Handles anything that isn't a plain web page load. Returns true when the WebView must NOT
   * load the URL itself. WalletConnect links pair in-app (proposal sheet with Verify + phishing
   * review); other app schemes are never loaded (that's the ERR_UNKNOWN_URL_SCHEME page) and never
   * launch another app from an untrusted page; intent:// fallbacks load in-app after the phishing check.
   */
  const handleAppLink = (target: string): boolean => {
    if (isWalletConnectNavigation(target) && !extractWalletConnectUri(target)) {
      // Never hand an empty/malformed link to the WalletConnect screen.
      setError('This page tried to open WalletConnect without a valid link. Use Connect on the page instead.');
      return true;
    }
    const decision = classifyBrowserNavigation(target);
    if (decision.kind === 'load') {
      return false;
    }
    if (decision.kind === 'walletconnect') {
      // BoreDefi's own option (wc:, boredefi://wc, boredefi.com/wc): pair right away.
      pairFromPage(decision.uri, null);
      return true;
    }
    if (decision.kind === 'external') {
      openOtherWallet(decision);
      return true;
    }
    if (decision.kind === 'store') {
      openStore(decision.url);
      return true;
    }
    if (decision.kind === 'coinbase-popup') {
      offerCoinbaseApp();
      return true;
    }
    if (decision.kind === 'redirect') {
      const verdict = checkPhishing(decision.url);
      if (verdict.blocked) {
        setError(`Blocked: ${verdict.reason} Your wallet was not connected.`);
        return true;
      }
      setUrl(decision.url);
      setDraft(decision.url);
      setPageUrl(decision.url);
      return true;
    }
    setNotice(blockedSchemeMessage(decision.scheme));
    return true;
  };

  const intercept = (request: WebViewNavigation) => {
    const target = request.url || '';
    if (handleAppLink(target)) {
      return false;
    }
    const verdict = checkPhishing(target);
    if (verdict.blocked) {
      setError(`Blocked: ${verdict.reason} Your wallet was not connected.`);
      return false;
    }
    return true;
  };

  /**
   * Another wallet's link (metamask://, trust://, its universal link, Android intent://): hand it to
   * the OS like Safari, so that wallet opens and approves; the dApp here gets the session over the
   * WalletConnect relay. BoreDefi never pairs it, and only after a real tap on the page.
   */
  const openOtherWallet = (decision: Extract<BrowserNavDecision, { kind: 'external' }>) => {
    if (Date.now() - lastTouchRef.current > TAP_WINDOW_MS) {
      setNotice(`This page tried to open ${decision.wallet} without a tap. Tap the wallet button on the page to open it.`);
      return;
    }
    if (decision.wcUri && !claimHandoff(handoffsRef.current, decision.wcUri, 'external')) {
      setNotice('BoreDefi already connected with that link, so it was not sent to another wallet.');
      return;
    }
    const last = lastExternalRef.current;
    const now = Date.now();
    if (last && last.url === decision.url && now - last.at < 3000) {
      return; // window.open + redirect for the same link: open once
    }
    lastExternalRef.current = { url: decision.url, at: now };
    Linking.openURL(decision.url).catch(() => {
      // Not installed (iOS rejects an app scheme nobody handles; Android has no activity for it).
      // Like Safari plus the wallet's own "Get" button: send the user to the store, never do nothing.
      if (decision.fallbackUrl) {
        handleAppLink(decision.fallbackUrl) || open(decision.fallbackUrl);
        return;
      }
      const store = decision.packageName
        ? `https://play.google.com/store/apps/details?id=${decision.packageName}`
        : walletStoreUrl(decision.wallet, Platform.OS);
      if (store) {
        setNotice(`${decision.wallet} isn't installed. Opening the ${Platform.OS === 'ios' ? 'App Store' : 'Play Store'} so you can get it.`);
        Linking.openURL(store).catch(() => setNotice(`${decision.wallet} didn't open. It may not be installed on this device.`));
        return;
      }
      setNotice(`${decision.wallet} didn't open. It may not be installed. Use the page's "Get" button to install it.`);
    });
  };

  /** A wallet's "Get" button (App Store / Play Store page): open the store app, like Safari. */
  const openStore = (storeUrl: string) => {
    if (Date.now() - lastTouchRef.current > TAP_WINDOW_MS) {
      setNotice('This page tried to open the app store without a tap. Tap the button on the page again.');
      return;
    }
    const last = lastExternalRef.current;
    const now = Date.now();
    if (last && last.url === storeUrl && now - last.at < 3000) {
      return;
    }
    lastExternalRef.current = { url: storeUrl, at: now };
    Linking.openURL(storeUrl).catch(() => setNotice("The app store didn't open."));
  };

  /**
   * Coinbase's SDK wants a keys.coinbase.com popup that talks back to the page through
   * window.opener. No in-app browser can host that (Coinbase shows "This app doesn't support
   * Coinbase Wallet"), so the popup is never loaded here. Offer the Coinbase Wallet app instead:
   * it opens this page in Coinbase Wallet's own browser, where Coinbase connects directly.
   */
  const offerCoinbaseApp = () => {
    if (Date.now() - lastTouchRef.current > TAP_WINDOW_MS) {
      setNotice('This page tried to open Coinbase without a tap. Tap Coinbase Wallet on the page again.');
      return;
    }
    if (pendingConfirm) {
      return;
    }
    const site = pageUrl;
    const host = dappHost(site) ?? 'this site';
    requestConfirm({
      title: 'Open in Coinbase Wallet?',
      network: selectedChain.name,
      mode: 'buttons',
      confirmLabel: 'Open Coinbase Wallet',
      cancelLabel: 'Not now',
      extra: [{ label: 'Site', value: host }],
      warnings: [
        "Coinbase's sign-in window can't run inside an in-app browser. Coinbase Wallet will open " +
          `${host} in its own browser, and you connect there. To stay in BoreDefi, pick WalletConnect or BoreDefi on the site.`,
      ],
    }).then((ok) => {
      if (!ok) {
        return;
      }
      Linking.openURL(coinbaseDappLink(site)).catch(() => {
        const store = walletStoreUrl('Coinbase Wallet', Platform.OS);
        if (store) {
          Linking.openURL(store).catch(() => undefined);
        }
      });
    });
  };

  const onLoadError = (err: { description: string; code?: number; url?: string }) => {
    if (!isUnknownSchemeError(err)) {
      setError(err.description);
      return;
    }
    // Android's native hook lets a navigation through if the JS thread is busy for 250 ms, so an
    // app link can still reach the loader. Handle the link now and put the last good page back
    // instead of leaving the "Error loading page" screen up.
    if (!err.url || !handleAppLink(err.url)) {
      setNotice('This page tried to open a link the in-app browser cannot show. It was skipped.');
    }
    setUrl(pageUrl);
    setDraft(pageUrl);
    setWebKey((key) => key + 1);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.title}>Browser</Text>
      <Text style={styles.copy}>dApps stay in-app. Injected EIP-1193 provider. Not a Chrome extension.</Text>
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <Pressable onPress={() => setNotice(null)} style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
      ) : null}
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
          onFocus={() => {
            editingRef.current = true;
          }}
          onBlur={() => {
            editingRef.current = false;
          }}
        />
        <Button label="Go" onPress={() => open(draft)} style={styles.go} />
      </View>
      <View style={styles.bookmarks}>
        {DAPP_BOOKMARKS.map((item) => (
          <Pressable
            key={item.url}
            onPress={() => open(item.url)}
            style={styles.chip}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.blurb}`}
          >
            <Text style={styles.chipText}>{item.name}</Text>
          </Pressable>
        ))}
      </View>
      {Platform.OS === 'web' && isCoinGeckoUrl(url) ? (
        <View style={styles.web}>
          <CoinGeckoWebEmbed url={url} onOpenUrl={open} />
        </View>
      ) : (
        <View
          style={styles.webWrap}
          onTouchStart={() => {
            lastTouchRef.current = Date.now();
          }}
        >
        <InAppBrowserView
          key={webKey}
          ref={webRef}
          uri={url}
          style={styles.web}
          injectedJavaScriptBeforeContentLoaded={injectedSourceRef.current}
          onLoadEnd={() => {
            webRef.current?.injectJavaScript(providerSyncScript(session.address, selectedChain.id));
          }}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={intercept}
          onNavigationStateChange={(nav) => {
            const nextOrigin = dappOrigin(nav.url);
            if (!nextOrigin) {
              return;
            }
            setPageUrl(nav.url);
            setDraft((current) => urlBarAfterNavigation(current, nav.url, editingRef.current));
            // Leaving the connected site drops the connection, so a redirect cannot inherit it.
            const connectedOrigin = connectedOriginRef.current;
            if (connectedOrigin && nextOrigin !== connectedOrigin) {
              setConnectedOrigin(null);
              webRef.current?.injectJavaScript(providerEmitScript('accountsChanged', []));
            }
          }}
          onError={onLoadError}
        />
        </View>
      )}
      {pendingProtected ? (
        <ProtectedGuardSheet
          verdict={pendingProtected.verdict}
          network={selectedChain.name}
          dapp={pendingProtected.site}
          preview={pendingProtected.preview}
          onApprove={(clearance) => {
            pendingProtected.resolve(clearance);
            setPendingProtected(null);
          }}
          onReject={() => {
            pendingProtected.resolve(null);
            setPendingProtected(null);
          }}
        />
      ) : null}
      <ConfirmSheet
        visible={Boolean(pendingConfirm)}
        title={pendingConfirm?.title ?? ''}
        network={pendingConfirm?.network ?? selectedChain.name}
        from={pendingConfirm?.from}
        to={pendingConfirm?.to}
        amount={pendingConfirm?.amount}
        fee={pendingConfirm?.fee}
        preview={pendingConfirm?.preview}
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
