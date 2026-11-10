import { extractWalletConnectUri } from './wc';
import { isKnownWalletUniversalLink, walletLinkSource } from './wc-source';

/**
 * What the in-app browser should do with a URL a page tries to open (link, redirect,
 * window.open, iframe, or a failed load). Pure so it can be unit tested.
 *
 * - load:          an ordinary web URL; the WebView loads it (phishing check still applies).
 * - walletconnect: BoreDefi's own pairing link (wc:, boredefi://wc, boredefi.com/wc?uri=).
 * - external:      another wallet's link; handed to the OS like Safari does, never paired here.
 * - redirect:      an Android intent:// link with an http(s) browser_fallback_url; load the
 *                  fallback in-app instead (after the phishing check), never launch the intent.
 * - blocked:       any other app scheme (metamask:, trust:, intent:, tel:, market:, ...). The
 *                  WebView must not try to load it (that is what shows "Error loading page /
 *                  net::ERR_UNKNOWN_URL_SCHEME"), and pages never get to launch other apps.
 */
export type BrowserNavDecision =
  | { kind: 'load' }
  | { kind: 'walletconnect'; uri: string }
  | {
      kind: 'external';
      /** What to hand to the OS (Linking.openURL). For intent:// this is the converted app link. */
      url: string;
      /** Wallet the page meant to open ("MetaMask", "Trust Wallet", or "another wallet app"). */
      wallet: string;
      /** Pairing URI inside the link, if any (claimed so BoreDefi never pairs the same link). */
      wcUri: string | null;
      /** Android intent:// fallbacks if the app isn't installed. */
      fallbackUrl: string | null;
      packageName: string | null;
    }
  | { kind: 'redirect'; url: string }
  | { kind: 'blocked'; scheme: string };

/** Schemes the WebView can render itself. Everything else is an app hand-off. */
const WEBVIEW_SCHEMES = new Set(['http', 'https', 'about', 'blob', 'data', 'javascript']);
/** Links that are BoreDefi's own WalletConnect option. */
const OWN_SCHEMES = new Set(['wc', 'boredefi']);

export function urlScheme(raw: string | null | undefined): string | null {
  const match = /^\s*([a-z][a-z0-9+.-]*):/i.exec(raw ?? '');
  return match ? match[1].toLowerCase() : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isBoreDefiHost(url: string): boolean {
  const host = /^https?:\/\/([^/?#:]+)/i.exec(url)?.[1]?.toLowerCase() ?? '';
  return host === 'boredefi.com' || host.endsWith('.boredefi.com');
}

type IntentParts = { target: string | null; scheme: string | null; packageName: string | null; fallbackUrl: string | null };

/** Splits an Android intent:// URL into the app link it stands for and its fallbacks. */
export function parseIntentUrl(raw: string): IntentParts {
  const hash = raw.indexOf('#Intent;');
  const body = hash < 0 ? raw : raw.slice(0, hash);
  const extras = hash < 0 ? [] : raw.slice(hash + '#Intent;'.length).split(';');
  let scheme: string | null = null;
  let packageName: string | null = null;
  let fallbackUrl: string | null = null;
  for (const part of extras) {
    if (part.startsWith('scheme=')) {
      const value = part.slice('scheme='.length).toLowerCase();
      scheme = /^[a-z][a-z0-9+.-]*$/.test(value) ? value : null;
    } else if (part.startsWith('package=')) {
      const value = part.slice('package='.length);
      packageName = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(value) ? value : null;
    } else if (part.startsWith('S.browser_fallback_url=')) {
      const value = safeDecode(part.slice('S.browser_fallback_url='.length)).trim();
      fallbackUrl = /^https?:\/\/[^\s/?#]+/i.test(value) && !/[\s<>"]/.test(value) ? value : null;
    }
  }
  const rest = body.replace(/^intent:(\/\/)?/i, '');
  return { target: scheme ? `${scheme}://${rest}` : null, scheme, packageName, fallbackUrl };
}

/** Android intent:// URL -> its browser_fallback_url, only when that is a plain http(s) URL. */
export function intentFallbackUrl(raw: string): string | null {
  return parseIntentUrl(raw).fallbackUrl;
}

/**
 * Safari-like routing for the in-app browser:
 * - BoreDefi's own WalletConnect option (bare wc:, boredefi://wc, boredefi.com/wc) pairs BoreDefi.
 * - Another wallet's link (metamask://, trust://, rainbow://, cbwallet://, its universal link, or
 *   any link carrying a wc: URI meant for someone else) goes to that wallet through the OS. BoreDefi
 *   never pairs it; the dApp in our WebView gets the session over the WalletConnect relay.
 * - Other app schemes (tel:, market:, unknown apps) are blocked.
 */
export function classifyBrowserNavigation(raw: string | null | undefined): BrowserNavDecision {
  const url = (raw ?? '').trim();
  if (!url) {
    return { kind: 'load' };
  }
  const scheme = urlScheme(url);
  if (scheme === 'http' || scheme === 'https') {
    const wc = /[?&]uri=/i.test(url) ? extractWalletConnectUri(url) : null;
    if (wc) {
      return isBoreDefiHost(url)
        ? { kind: 'walletconnect', uri: wc }
        : { kind: 'external', url, wallet: walletLinkSource(url) ?? 'another wallet app', wcUri: wc, fallbackUrl: null, packageName: null };
    }
    const wallet = walletLinkSource(url);
    // Known wallet universal links (metamask.app.link/..., link.trustwallet.com/...) open the wallet.
    return wallet && wallet !== 'another wallet app' && isKnownWalletUniversalLink(url)
      ? { kind: 'external', url, wallet, wcUri: null, fallbackUrl: null, packageName: null }
      : { kind: 'load' };
  }
  if (scheme && WEBVIEW_SCHEMES.has(scheme)) {
    return { kind: 'load' };
  }
  if (scheme === 'intent') {
    const intent = parseIntentUrl(url);
    const wc = extractWalletConnectUri(url.split('#Intent;')[0]);
    if (intent.scheme && OWN_SCHEMES.has(intent.scheme)) {
      return wc ? { kind: 'walletconnect', uri: wc } : { kind: 'blocked', scheme: 'intent' };
    }
    const wallet = intent.target ? walletLinkSource(intent.target) : null;
    if (intent.target && (wc || (wallet && wallet !== 'another wallet app'))) {
      return {
        kind: 'external',
        url: intent.target,
        wallet: wallet ?? 'another wallet app',
        wcUri: wc,
        fallbackUrl: intent.fallbackUrl,
        packageName: intent.packageName,
      };
    }
    if (intent.fallbackUrl) {
      const inner = classifyBrowserNavigation(intent.fallbackUrl);
      return inner.kind === 'load' ? { kind: 'redirect', url: intent.fallbackUrl } : inner;
    }
    return { kind: 'blocked', scheme: 'intent' };
  }
  const wc = extractWalletConnectUri(url);
  if (scheme && OWN_SCHEMES.has(scheme)) {
    return wc ? { kind: 'walletconnect', uri: wc } : { kind: 'blocked', scheme };
  }
  // wc%3A... (scheme-less encoded pairing link) is BoreDefi's to pair.
  if (!scheme && wc) {
    return { kind: 'walletconnect', uri: wc };
  }
  const wallet = walletLinkSource(url);
  if (wc || (wallet && wallet !== 'another wallet app')) {
    return { kind: 'external', url, wallet: wallet ?? 'another wallet app', wcUri: wc, fallbackUrl: null, packageName: null };
  }
  return { kind: 'blocked', scheme: scheme ?? 'unknown' };
}

/** A WebView load error caused by a link to an app scheme the WebView can't render. */
export function isUnknownSchemeError(input: { code?: number; description?: string; url?: string }): boolean {
  if (input.code === -10 || /ERR_UNKNOWN_URL_SCHEME/i.test(input.description ?? '')) {
    return true;
  }
  // iOS NSURLErrorUnsupportedURL
  if (input.code === -1002) {
    return true;
  }
  return Boolean(input.url) && classifyBrowserNavigation(input.url).kind !== 'load';
}

export function blockedSchemeMessage(scheme: string): string {
  return `This page tried to open another app (${scheme}:). BoreDefi keeps dApps in the wallet: pick "BoreDefi", "Browser Wallet" or "Injected" on the page, or choose WalletConnect.`;
}
