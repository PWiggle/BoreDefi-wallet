// Build 24: every wallet option on a dApp opens from BoreDefi's in-app browser the way Safari does.
// Regressions from Patrick's build 23 test on boredswap.app (iPhone):
//  1. WalletConnect's wallet list / wallets that aren't installed: nothing opened.
//  2. Coinbase Wallet: keys.coinbase.com replaced the page with "This app doesn't support Coinbase Wallet".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { classifyBrowserNavigation, coinbaseDappLink, isAppStoreLink, isCoinbasePopupLink } from './browser-nav';
import { injectedProviderSource, isGestureMessage } from './injected-provider';
import { isKnownWalletUniversalLink, walletStoreUrl } from './wc-source';

const WC =
  'wc:7f6e504bfad60b485450578e05678ed3e8e8c4751d3c6160be17160d63ec90f9@2?relay-protocol=irn&symKey=587d5484ce2a2a6ee3ba1962fdd7e8588e06200c46823bd18fbd67def96ad303';
const ENC = encodeURIComponent(WC);

test('WalletConnect wallet-list links (Reown AppKit formatNativeUrl / formatUniversalUrl) go to that wallet', () => {
  const cases: [string, string][] = [
    [`trust://wc?uri=${ENC}`, 'Trust Wallet'],
    [`metamask://wc?uri=${ENC}`, 'MetaMask'],
    [`rainbow://wc?uri=${ENC}`, 'Rainbow'],
    [`cbwallet://wc?uri=${ENC}`, 'Coinbase Wallet'],
    [`zerion://wc?uri=${ENC}`, 'Zerion'],
    [`https://metamask.app.link/wc?uri=${ENC}`, 'MetaMask'],
    [`https://link.trustwallet.com/wc?uri=${ENC}`, 'Trust Wallet'],
    [`https://rnbwapp.com/wc?uri=${ENC}`, 'Rainbow'],
    [`https://phantom.app/ul/wc?uri=${ENC}`, 'Phantom'],
    [`bitkeep://wc?uri=${ENC}`, 'another wallet app'],
    [`https://wallet.example.org/wc?uri=${ENC}`, 'another wallet app'],
  ];
  for (const [url, wallet] of cases) {
    const d = classifyBrowserNavigation(url);
    assert.equal(d.kind, 'external', url);
    if (d.kind === 'external') {
      assert.equal(d.wallet, wallet, url);
      assert.equal(d.wcUri, WC, url);
    }
  }
});

test('Coinbase links: WalletLink deep link opens the app; keys.coinbase.com popup is never loaded', () => {
  const walletlink = 'https://go.cb-w.com/walletlink?redirect_url=https%3A%2F%2Fboredswap.app%2F&wl_url=https%3A%2F%2Fwww.walletlink.org%2F%23%2Flink';
  const d = classifyBrowserNavigation(walletlink);
  assert.equal(d.kind, 'external');
  assert.equal(d.kind === 'external' && d.wallet, 'Coinbase Wallet');
  assert.equal(classifyBrowserNavigation('https://go.cb-w.com/dapp?cb_url=https%3A%2F%2Fboredswap.app').kind, 'external');
  for (const url of [
    'https://keys.coinbase.com/connect?sdkName=%40coinbase%2Fwallet-sdk&sdkVersion=4.3.0&origin=https%3A%2F%2Fboredswap.app&coop=null',
    'https://keys.coinbase.com/sign',
  ]) {
    assert.equal(classifyBrowserNavigation(url).kind, 'coinbase-popup', url);
    assert.equal(isCoinbasePopupLink(url), true);
  }
  assert.equal(isCoinbasePopupLink('https://www.coinbase.com/'), false);
  assert.equal(classifyBrowserNavigation('https://www.coinbase.com/').kind, 'load');
  assert.equal(coinbaseDappLink('https://boredswap.app/?a=1'), 'https://go.cb-w.com/dapp?cb_url=https%3A%2F%2Fboredswap.app%2F%3Fa%3D1');
});

test('store links from a wallet "Get" button open the store app, other Apple/Google pages load in-app', () => {
  for (const url of [
    'https://apps.apple.com/us/app/metamask/id1438144202',
    'https://apps.apple.com/app/id1288339409',
    'https://itunes.apple.com/us/app/trust-crypto-bitcoin-wallet/id1288339409?mt=8',
    'https://play.google.com/store/apps/details?id=io.metamask',
    'itms-apps://apps.apple.com/app/id1438144202',
    'market://details?id=com.wallet.crypto.trustapp',
  ]) {
    assert.equal(isAppStoreLink(url), true, url);
    assert.equal(classifyBrowserNavigation(url).kind, 'store', url);
  }
  for (const url of ['https://www.apple.com/iphone/', 'https://play.google.com/store/movies', 'https://google.com/']) {
    assert.equal(classifyBrowserNavigation(url).kind, 'load', url);
  }
});

test('wallet sites still browse in-app; only their app-link paths hand off', () => {
  assert.equal(classifyBrowserNavigation('https://phantom.app/').kind, 'load');
  assert.equal(classifyBrowserNavigation('https://phantom.app/download').kind, 'load');
  assert.equal(classifyBrowserNavigation('https://phantom.app/ul/browse/https%3A%2F%2Fboredswap.app').kind, 'external');
  assert.equal(isKnownWalletUniversalLink('https://rainbow.me/wc'), true);
  assert.equal(isKnownWalletUniversalLink('https://rainbow.me/'), false);
  assert.equal(classifyBrowserNavigation('https://app.uniswap.org/swap').kind, 'load');
});

test('a wallet that is not installed falls back to its store page', () => {
  assert.equal(walletStoreUrl('MetaMask', 'ios'), 'https://apps.apple.com/app/id1438144202');
  assert.equal(walletStoreUrl('MetaMask', 'android'), 'https://play.google.com/store/apps/details?id=io.metamask');
  assert.equal(walletStoreUrl('Trust Wallet', 'ios'), 'https://apps.apple.com/app/id1288339409');
  assert.equal(walletStoreUrl('Rainbow', 'ios'), 'https://apps.apple.com/app/id1457119021');
  assert.equal(walletStoreUrl('Coinbase Wallet', 'ios'), 'https://apps.apple.com/app/id1278383455');
  assert.equal(walletStoreUrl('Coinbase Wallet', 'android'), 'https://play.google.com/store/apps/details?id=org.toshi');
  assert.equal(walletStoreUrl('Phantom', 'ios'), 'https://apps.apple.com/app/id1598432977');
  assert.equal(walletStoreUrl('another wallet app', 'ios'), null);
  assert.equal(walletStoreUrl('MetaMask', 'web'), null);
});

/** Fake page with a document still loading (the document-start run), anchors and a WK bridge. */
function fakePage(key: string, opts: { readyState?: string } = {}) {
  const posted: unknown[] = [];
  const secure: unknown[] = [];
  const winListeners: Record<string, ((e: unknown) => void)[]> = {};
  const docListeners: Record<string, ((e: unknown) => void)[]> = {};
  const opened: string[] = [];
  const nativeClicks: string[] = [];
  class HTMLAnchorElement {
    attrs: Record<string, string> = {};
    target = '';
    get href() {
      return this.attrs.href ?? '';
    }
    set href(v: string) {
      this.attrs.href = v;
    }
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    }
    click() {
      nativeClicks.push(this.attrs.href);
    }
  }
  const wkHandler = { postMessage: (data: string) => secure.push(JSON.parse(data)) };
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (data: string) => posted.push(JSON.parse(data)) },
    webkit: { messageHandlers: { ReactNativeWebView: wkHandler } },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (winListeners[type] ??= []).push(fn);
    },
    dispatchEvent: (event: { type: string }) => {
      (winListeners[event.type] ?? []).forEach((fn) => fn(event));
      return true;
    },
    open: (url: string) => {
      opened.push(url);
      return {};
    },
    HTMLAnchorElement,
  };
  class CustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  class Event {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  }
  const document = {
    readyState: opts.readyState ?? 'loading',
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (docListeners[type] ??= []).push(fn);
    },
  };
  const context = vm.createContext({ window, document, CustomEvent, Event, JSON, Promise, Object, String, Error, Date });
  vm.runInContext(injectedProviderSource(key), context);
  return { window, posted, secure, winListeners, docListeners, opened, nativeClicks, context, HTMLAnchorElement, wkHandler };
}

test('injected script routes wallet web links from window.open instead of opening a popup', () => {
  const page = fakePage('k1');
  const open = page.window.open as (url: string, target?: string) => unknown;
  const links = [
    `https://metamask.app.link/wc?uri=${ENC}`,
    `https://link.trustwallet.com/wc?uri=${ENC}`,
    `https://wallet.example.org/wc?uri=${ENC}`,
    'https://keys.coinbase.com/connect?sdkName=x',
    'https://apps.apple.com/app/id1288339409',
    'https://play.google.com/store/apps/details?id=io.metamask',
    `trust://wc?uri=${ENC}`,
  ];
  for (const url of links) {
    assert.equal(open(url, '_blank'), null, url);
  }
  assert.deepEqual(page.opened, [], 'none reach the real window.open');
  assert.deepEqual(
    page.posted.map((p) => (p as { url: string }).url),
    links,
  );
  // Ordinary pages still open normally.
  assert.notEqual(open('https://app.aave.com', '_blank'), null);
  assert.deepEqual(page.opened, ['https://app.aave.com']);
});

test('detached <a target=_blank>.click() (RainbowKit, Coinbase SDK) is routed; normal links still click', () => {
  const page = fakePage('k1');
  const A = page.HTMLAnchorElement as unknown as new () => { href: string; target: string; click: () => void };
  const a = new A();
  a.href = `https://link.trustwallet.com/wc?uri=${ENC}`;
  a.target = '_blank';
  a.click();
  const cb = new A();
  cb.href = 'https://go.cb-w.com/walletlink?redirect_url=x&wl_url=y';
  cb.target = 'cbw-opener';
  cb.click();
  assert.deepEqual(page.nativeClicks, []);
  assert.deepEqual(page.posted.slice(-2), [
    { type: 'boredefi:open', url: `https://link.trustwallet.com/wc?uri=${ENC}` },
    { type: 'boredefi:open', url: 'https://go.cb-w.com/walletlink?redirect_url=x&wl_url=y' },
  ]);
  const plain = new A();
  plain.href = 'https://docs.boredswap.app';
  plain.click();
  assert.deepEqual(page.nativeClicks, ['https://docs.boredswap.app']);
});

test('in-page clicks on wallet web links are routed too', () => {
  const page = fakePage('k1');
  let prevented = false;
  const anchor = { nodeType: 1, tagName: 'A', href: 'https://apps.apple.com/app/id1438144202', getAttribute: () => 'https://apps.apple.com/app/id1438144202', parentNode: null };
  page.docListeners.click[0]({ target: anchor, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(page.posted.at(-1), { type: 'boredefi:open', url: 'https://apps.apple.com/app/id1438144202' });
});

test('real taps are reported with the secret key over the captured bridge; synthetic events are not', () => {
  const page = fakePage('secret-key');
  // A page script hooks the public bridge afterwards; it must never see the key.
  const sniffed: string[] = [];
  (page.window.ReactNativeWebView as { postMessage: (d: string) => void }).postMessage = (d: string) => sniffed.push(d);
  page.wkHandler.postMessage = (d: string) => sniffed.push(d);
  const fire = (type: string, isTrusted: boolean) => (page.winListeners[type] ?? []).forEach((fn) => fn({ type, isTrusted }));
  fire('touchstart', false);
  fire('click', false);
  assert.deepEqual(page.secure, []);
  fire('touchstart', true);
  assert.deepEqual(page.secure, [{ type: 'boredefi:gesture', key: 'secret-key' }]);
  fire('click', true); // throttled (same tap)
  assert.equal(page.secure.length, 1);
  assert.deepEqual(sniffed, []);
  assert.equal(isGestureMessage(JSON.stringify({ type: 'boredefi:gesture', key: 'secret-key' }), 'secret-key'), true);
  assert.equal(isGestureMessage(JSON.stringify({ type: 'boredefi:gesture', key: 'guess' }), 'secret-key'), false);
  assert.equal(isGestureMessage(JSON.stringify({ type: 'boredefi:gesture', key: '' }), ''), false);
  assert.equal(isGestureMessage('nope', 'secret-key'), false);
});

test('only the document-start run reports taps (a late re-injection could be hooked by the page)', () => {
  const late = fakePage('secret-key', { readyState: 'complete' });
  (late.winListeners.touchstart ?? []).forEach((fn) => fn({ type: 'touchstart', isTrusted: true }));
  assert.deepEqual(late.secure, []);
  assert.equal(late.winListeners.touchstart, undefined);
});

test('Browser screen: 30s tap window, page taps count, store fallback, Coinbase popup never loads', () => {
  const screen = readFileSync(join(__dirname, '../screens/BrowserScreen.tsx'), 'utf8');
  assert.match(screen, /const TAP_WINDOW_MS = 30_000;/);
  assert.match(screen, /isGestureMessage\(event\.nativeEvent\.data, gestureKeyRef\.current\)/);
  assert.match(screen, /injectedJavaScriptBeforeContentLoaded=\{injectedSourceRef\.current\}/);
  assert.match(screen, /walletStoreUrl\(decision\.wallet, Platform\.OS\)/);
  assert.match(screen, /if \(decision\.kind === 'store'\) \{\s*openStore\(decision\.url\);\s*return true;/);
  assert.match(screen, /if \(decision\.kind === 'coinbase-popup'\) \{\s*offerCoinbaseApp\(\);\s*return true;/);
  // Store and Coinbase hand-offs are tap-gated too.
  const store = screen.slice(screen.indexOf('const openStore'), screen.indexOf('const offerCoinbaseApp'));
  assert.ok(store.indexOf('TAP_WINDOW_MS') < store.indexOf('Linking.openURL('));
  const cb = screen.slice(screen.indexOf('const offerCoinbaseApp'), screen.indexOf('const onLoadError'));
  assert.ok(cb.indexOf('TAP_WINDOW_MS') < cb.indexOf('requestConfirm('));
  assert.match(cb, /coinbaseDappLink\(site\)/);
});
