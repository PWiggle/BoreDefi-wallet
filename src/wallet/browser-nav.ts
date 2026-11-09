import { extractWalletConnectUri } from './wc';

/**
 * What the in-app browser should do with a URL a page tries to open (link, redirect,
 * window.open, iframe, or a failed load). Pure so it can be unit tested.
 *
 * - load:          an ordinary web URL; the WebView loads it (phishing check still applies).
 * - walletconnect: a WalletConnect pairing hand-off (wc:, boredefi://wc, metamask://wc?uri=,
 *                  https://.../wc?uri=wc:..., intent://wc?uri=...). Pair inside BoreDefi so the
 *                  session proposal sheet (with Verify + phishing review) appears.
 * - redirect:      an Android intent:// link with an http(s) browser_fallback_url; load the
 *                  fallback in-app instead (after the phishing check), never launch the intent.
 * - blocked:       any other app scheme (metamask:, trust:, intent:, tel:, market:, ...). The
 *                  WebView must not try to load it (that is what shows "Error loading page /
 *                  net::ERR_UNKNOWN_URL_SCHEME"), and pages never get to launch other apps.
 */
export type BrowserNavDecision =
  | { kind: 'load' }
  | { kind: 'walletconnect'; uri: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'blocked'; scheme: string };

/** Schemes the WebView can render itself. Everything else is an app hand-off. */
const WEBVIEW_SCHEMES = new Set(['http', 'https', 'about', 'blob', 'data', 'javascript']);

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

/** Android intent:// URL -> its browser_fallback_url, only when that is a plain http(s) URL. */
export function intentFallbackUrl(raw: string): string | null {
  const hash = raw.indexOf('#Intent;');
  if (hash < 0) {
    return null;
  }
  const extras = raw.slice(hash + '#Intent;'.length).split(';');
  for (const part of extras) {
    if (part.startsWith('S.browser_fallback_url=')) {
      const value = safeDecode(part.slice('S.browser_fallback_url='.length)).trim();
      if (/^https?:\/\/[^\s/?#]+/i.test(value) && !/[\s<>"]/.test(value)) {
        return value;
      }
      return null;
    }
  }
  return null;
}

export function classifyBrowserNavigation(raw: string | null | undefined): BrowserNavDecision {
  const url = (raw ?? '').trim();
  if (!url) {
    return { kind: 'load' };
  }
  const scheme = urlScheme(url);
  if (scheme === 'http' || scheme === 'https') {
    // Universal links that carry a pairing URI (https://metamask.app.link/wc?uri=wc:..., our own
    // https://www.boredefi.com/wc?uri=...). Only when uri= really is a wc: pairing link.
    const wc = /[?&]uri=/i.test(url) ? extractWalletConnectUri(url) : null;
    return wc ? { kind: 'walletconnect', uri: wc } : { kind: 'load' };
  }
  if (scheme && WEBVIEW_SCHEMES.has(scheme)) {
    return { kind: 'load' };
  }
  // wc:, wc%3A..., boredefi://wc?uri=, metamask://wc?uri=, trust://wc?uri=, rainbow://wc?uri=...
  const wc = extractWalletConnectUri(scheme === 'intent' ? url.split('#Intent;')[0] : url);
  if (wc) {
    return { kind: 'walletconnect', uri: wc };
  }
  if (scheme === 'intent') {
    const fallback = intentFallbackUrl(url);
    if (fallback) {
      const inner = classifyBrowserNavigation(fallback);
      return inner.kind === 'walletconnect' ? inner : { kind: 'redirect', url: fallback };
    }
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
