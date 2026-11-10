import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
  blockedSchemeMessage,
  classifyBrowserNavigation,
  intentFallbackUrl,
  isUnknownSchemeError,
  parseIntentUrl,
  urlScheme,
} from './browser-nav';
import { INJECTED_PROVIDER_SOURCE, parseOpenMessage } from './injected-provider';

const WC =
  'wc:7f6e504bfad60b485450578e05678ed3e8e8c4751d3c6160be17160d63ec90f9@2?relay-protocol=irn&symKey=587d5484ce2a2a6ee3ba1962fdd7e8588e06200c46823bd18fbd67def96ad303';
const ENC = encodeURIComponent(WC);

test('plain web navigations load as before', () => {
  for (const url of [
    'https://app.aave.com/',
    'https://app.morpho.org/ethereum/earn',
    'http://localhost:8081',
    'about:blank',
    'about:srcdoc',
    'blob:https://app.aave.com/1234',
    'data:text/html,hi',
    '',
  ]) {
    assert.deepEqual(classifyBrowserNavigation(url), { kind: 'load' }, url);
  }
  // A normal https page whose query has an unrelated uri= param still loads.
  assert.deepEqual(classifyBrowserNavigation('https://example.com/?uri=https%3A%2F%2Fx.com'), { kind: 'load' });
});

test("BoreDefi's own WalletConnect links pair BoreDefi", () => {
  for (const url of [
    WC,
    'WC:' + WC.slice(3),
    ENC,
    `boredefi://wc?uri=${ENC}`,
    `https://www.boredefi.com/wc?uri=${ENC}`,
    `intent://wc?uri=${ENC}#Intent;scheme=boredefi;package=com.boredefi.wallet;end`,
  ]) {
    assert.deepEqual(classifyBrowserNavigation(url), { kind: 'walletconnect', uri: WC }, url);
  }
});

test("another wallet's link goes to that wallet through the OS (like Safari), never paired by BoreDefi", () => {
  const cases: [string, string, string | null][] = [
    [`metamask://wc?uri=${ENC}`, 'MetaMask', WC],
    [`trust://wc?uri=${ENC}`, 'Trust Wallet', WC],
    [`rainbow://wc?uri=${ENC}`, 'Rainbow', WC],
    [`cbwallet://wc?uri=${ENC}`, 'Coinbase Wallet', WC],
    [`https://metamask.app.link/wc?uri=${ENC}`, 'MetaMask', WC],
    [`https://link.trustwallet.com/wc?uri=${ENC}`, 'Trust Wallet', WC],
    [`https://unknownwallet.example/wc?uri=${ENC}`, 'another wallet app', WC],
    [`zengo://wc?uri=${ENC}`, 'another wallet app', WC],
    ['metamask://dapp/app.aave.com', 'MetaMask', null],
    ['trust://open_url?url=https://app.aave.com', 'Trust Wallet', null],
    ['https://metamask.app.link/dapp/boredswap.app', 'MetaMask', null],
  ];
  for (const [url, wallet, wcUri] of cases) {
    const decision = classifyBrowserNavigation(url);
    assert.equal(decision.kind, 'external', url);
    if (decision.kind === 'external') {
      assert.equal(decision.url, url);
      assert.equal(decision.wallet, wallet, url);
      assert.equal(decision.wcUri, wcUri, url);
    }
  }
});

test('Android intent:// for another wallet becomes its app link, with package and https fallbacks', () => {
  const decision = classifyBrowserNavigation(
    `intent://wc?uri=${ENC}#Intent;scheme=metamask;package=io.metamask;S.browser_fallback_url=https%3A%2F%2Fmetamask.io%2Fdownload;end`,
  );
  assert.deepEqual(decision, {
    kind: 'external',
    url: `metamask://wc?uri=${ENC}`,
    wallet: 'MetaMask',
    wcUri: WC,
    fallbackUrl: 'https://metamask.io/download',
    packageName: 'io.metamask',
  });
  assert.equal(parseIntentUrl('intent://x#Intent;scheme=foo;package=bad pkg;end').packageName, null);
});

test('regular wallet websites still load in-app (no wc: link, not a pure app-link host)', () => {
  for (const url of ['https://phantom.app/', 'https://app.uniswap.org/swap', 'https://keys.coinbase.com/connect', 'https://rainbow.me/']) {
    assert.deepEqual(classifyBrowserNavigation(url), { kind: 'load' }, url);
  }
});

test('non-wallet app schemes stay blocked', () => {
  for (const [url, scheme] of [
    ['tel:+15555550100', 'tel'],
    ['market://details?id=io.metamask', 'market'],
    ['sms:123', 'sms'],
    ['intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end', 'intent'],
    ['wc:', 'wc'],
    ['boredefi://wc?uri=', 'boredefi'],
  ] as const) {
    assert.deepEqual(classifyBrowserNavigation(url), { kind: 'blocked', scheme }, url);
  }
  assert.match(blockedSchemeMessage('tel'), /tel:/);
});

test('intent:// links fall back to their http(s) browser_fallback_url only', () => {
  const ok = 'intent://x#Intent;scheme=foo;package=com.foo;S.browser_fallback_url=https%3A%2F%2Fapp.aave.com%2F;end';
  assert.equal(intentFallbackUrl(ok), 'https://app.aave.com/');
  assert.deepEqual(classifyBrowserNavigation(ok), { kind: 'redirect', url: 'https://app.aave.com/' });
  for (const bad of [
    'intent://x#Intent;scheme=foo;S.browser_fallback_url=javascript%3Aalert(1);end',
    'intent://x#Intent;scheme=foo;S.browser_fallback_url=market%3A%2F%2Fdetails%3Fid%3Dx;end',
    'intent://x#Intent;scheme=foo;S.browser_fallback_url=file%3A%2F%2F%2Fsdcard%2Fa;end',
    'intent://x#Intent;scheme=foo;S.browser_fallback_url=https%3A%2F%2Fa.com%2F%3Cscript%3E;end',
    'intent://x#Intent;scheme=foo;end',
  ]) {
    assert.equal(intentFallbackUrl(bad), null, bad);
    assert.equal(classifyBrowserNavigation(bad).kind, 'blocked', bad);
  }
  // A fallback that is itself another wallet's universal link goes to that wallet.
  const wcFallback = `intent://x#Intent;scheme=foo;S.browser_fallback_url=${encodeURIComponent(`https://metamask.app.link/wc?uri=${ENC}`)};end`;
  assert.equal(classifyBrowserNavigation(wcFallback).kind, 'external');
});

test('recognises the Android ERR_UNKNOWN_URL_SCHEME page error (code -10) and iOS unsupported URL', () => {
  assert.equal(isUnknownSchemeError({ code: -10, description: 'net::ERR_UNKNOWN_URL_SCHEME', url: 'metamask://x' }), true);
  assert.equal(isUnknownSchemeError({ description: 'net::ERR_UNKNOWN_URL_SCHEME' }), true);
  assert.equal(isUnknownSchemeError({ code: -1002, description: 'unsupported URL' }), true);
  assert.equal(isUnknownSchemeError({ code: -2, description: 'net::ERR_NAME_NOT_RESOLVED', url: 'https://nope.invalid' }), false);
  assert.equal(urlScheme('MetaMask://x'), 'metamask');
  assert.equal(urlScheme('no-scheme'), null);
});

test('open hand-off messages are told apart from provider requests', () => {
  assert.equal(parseOpenMessage(JSON.stringify({ type: 'boredefi:open', url: WC })), WC);
  assert.equal(parseOpenMessage(JSON.stringify({ id: 1, payload: { method: 'eth_chainId' } })), null);
  assert.equal(parseOpenMessage('not json'), null);
  assert.equal(parseOpenMessage(JSON.stringify({ type: 'boredefi:open', url: 5 })), null);
});

/** Runs the real injected script against a tiny fake page. */
function fakePage() {
  const posted: unknown[] = [];
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const docListeners: Record<string, ((e: unknown) => void)[]> = {};
  const opened: string[] = [];
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (data: string) => posted.push(JSON.parse(data)) },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    dispatchEvent: (event: { type: string }) => {
      (listeners[event.type] ?? []).forEach((fn) => fn(event));
      return true;
    },
    open: (url: string) => {
      opened.push(url);
      return {};
    },
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
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (docListeners[type] ??= []).push(fn);
    },
  };
  const context = vm.createContext({ window, document, CustomEvent, Event, JSON, Promise, Object, String, Error });
  vm.runInContext(INJECTED_PROVIDER_SOURCE, context);
  // Injected twice (before content load + after load); must stay idempotent.
  vm.runInContext(INJECTED_PROVIDER_SOURCE, context);
  return { window, posted, listeners, docListeners, opened, context };
}

test('injected provider: window.ethereum + EIP-6963 announce + request round trip', async () => {
  const page = fakePage();
  const eth = page.window.ethereum as {
    isBoreDefi: boolean;
    isMetaMask: boolean;
    request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
    on: (e: string, h: (d: unknown) => void) => unknown;
    off: (e: string, h: (d: unknown) => void) => unknown;
    removeAllListeners: () => unknown;
    isConnected: () => boolean;
  };
  assert.equal(eth.isBoreDefi, true);
  assert.equal(eth.isConnected(), true);

  const announced: { info: { rdns: string; name: string }; provider: unknown }[] = [];
  (page.window.addEventListener as (t: string, f: (e: { detail: never }) => void) => void)(
    'eip6963:announceProvider',
    (e) => announced.push(e.detail),
  );
  (page.window.dispatchEvent as (e: { type: string }) => void)({ type: 'eip6963:requestProvider' });
  assert.equal(announced.length, 1, 'one announce per request even after double injection');
  assert.equal(announced[0].info.rdns, 'com.boredefi.wallet');
  assert.equal(announced[0].info.name, 'BoreDefi');
  assert.equal(announced[0].provider, eth);

  const pending = eth.request({ method: 'eth_requestAccounts' });
  const sent = page.posted.at(-1) as { id: number; payload: { method: string } };
  assert.equal(sent.payload.method, 'eth_requestAccounts');
  vm.runInContext(`window.__boredefiResolve(${sent.id}, ["0xabc"], null)`, page.context);
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), ['0xabc']);

  const seen: unknown[] = [];
  const handler = (d: unknown) => seen.push(d);
  eth.on('accountsChanged', handler);
  vm.runInContext(`window.__boredefiEmit('accountsChanged', ['0xabc'])`, page.context);
  eth.off('accountsChanged', handler);
  vm.runInContext(`window.__boredefiEmit('accountsChanged', [])`, page.context);
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), [['0xabc']]);
});

test('injected script hands app links from window.open and link clicks to the wallet', () => {
  const page = fakePage();
  const open = page.window.open as (url: string, target?: string) => unknown;

  assert.equal(open(WC, '_self'), null);
  assert.equal(open(`metamask://wc?uri=${ENC}`, '_blank'), null);
  assert.deepEqual(page.opened, [], 'app links never reach the real window.open');
  assert.deepEqual(page.posted, [
    { type: 'boredefi:open', url: WC },
    { type: 'boredefi:open', url: `metamask://wc?uri=${ENC}` },
  ]);

  // Web links go through untouched.
  assert.notEqual(open('https://app.aave.com', '_blank'), null);
  assert.deepEqual(page.opened, ['https://app.aave.com']);

  let prevented = false;
  const anchor = { nodeType: 1, tagName: 'A', getAttribute: () => 'trust://wc?uri=x', parentNode: null };
  const span = { nodeType: 1, tagName: 'SPAN', parentNode: anchor };
  page.docListeners.click[0]({ target: span, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(page.posted.at(-1), { type: 'boredefi:open', url: 'trust://wc?uri=x' });

  prevented = false;
  const web = { nodeType: 1, tagName: 'A', getAttribute: () => 'https://app.morpho.org', parentNode: null };
  page.docListeners.click[0]({ target: web, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test('Browser screen routes every app link through the classifier and never shows the raw error page', () => {
  const screen = readFileSync(join(__dirname, '../screens/BrowserScreen.tsx'), 'utf8');
  const view = readFileSync(join(__dirname, '../components/InAppBrowserView.tsx'), 'utf8');
  assert.match(screen, /onShouldStartLoadWithRequest=\{intercept\}/);
  assert.match(screen, /if \(handleAppLink\(target\)\) \{\s*return false;/);
  assert.match(screen, /parseOpenMessage\(event\.nativeEvent\.data\)/);
  assert.match(screen, /onError=\{onLoadError\}/);
  assert.match(screen, /isUnknownSchemeError\(err\)/);
  // Other apps open only from the user's "Open <wallet>" choice, for a known wallet, after the
  // one-link-one-wallet claim (untrusted pages can't launch apps by themselves).
  assert.match(screen, /if \(decision\.kind === 'external'\) \{\s*openOtherWallet\(decision\);/);
  assert.match(screen, /Date\.now\(\) - lastTouchRef\.current > TAP_WINDOW_MS/);
  assert.match(screen, /onTouchStart=\{\(\) => \{\s*lastTouchRef\.current = Date\.now\(\);/);
  assert.match(screen, /claimHandoff\(handoffsRef\.current, decision\.wcUri, 'external'\)[\s\S]*Linking\.openURL\(decision\.url\)/);
  // The tap window check comes before any Linking call.
  assert.ok(screen.indexOf('TAP_WINDOW_MS)') < screen.indexOf('Linking.openURL('));
  assert.match(view, /renderError=/);
  assert.match(view, /setSupportMultipleWindows=\{false\}/);
  assert.match(view, /originWhitelist=\{\['\*'\]\}/);
});

test('BoredSwap (RainbowKit): its BoreDefi tile pairs BoreDefi; its MetaMask/Trust tiles open those wallets', () => {
  // Captured from boredswap.app on Nov 9, 2026: the BoreDefi tile sets location.href to boredefi://wc.
  const boredswapWc =
    'wc:d8b7145b82f16012149ee605786ad991ea0b713e7303f208715622bcdfe6937b@2?relay-protocol=irn&symKey=c500d215e3a3311d091fa21ea0dcc102eb23376d53cd330f4806d187e83aff70&expiryTimestamp=1794266818';
  const enc = encodeURIComponent(boredswapWc);
  assert.deepEqual(classifyBrowserNavigation(`boredefi://wc?uri=${enc}`), { kind: 'walletconnect', uri: boredswapWc });
  for (const link of [`metamask://wc?uri=${enc}`, `https://metamask.app.link/wc?uri=${enc}`, `trust://wc?uri=${enc}`]) {
    const decision = classifyBrowserNavigation(link);
    assert.equal(decision.kind, 'external', link);
    assert.equal(decision.kind === 'external' && decision.wcUri, boredswapWc);
  }
  // iOS reports the failed load as NSURLErrorDomain -1002 with the page URL, not the app link.
  assert.equal(isUnknownSchemeError({ code: -1002, description: 'unsupported URL', url: 'https://boredswap.app/?chain=ethereum' }), true);
});

test('a second connect request from an already-connected site does not prompt again', () => {
  const screen = readFileSync(join(__dirname, '../screens/BrowserScreen.tsx'), 'utf8');
  assert.match(screen, /if \(kind === 'connect'\) \{\s*if \(isConnected\) \{/);
});
