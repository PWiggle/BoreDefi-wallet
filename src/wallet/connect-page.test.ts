// REGRESSION (iOS TestFlight build 12): tapping "Connect BoreDefi" on www.boredefi.com/connect in the
// in-app Browser showed "null is not an object (evaluating 'provider.request')".
// Cause: the wallet answered the page's follow-up eth_accounts from a stale React closure ([]),
// the page reset itself (provider = null) while a second refresh was still running, and that
// refresh then called provider.request on null. These tests lock both sides of the fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { INJECTED_PROVIDER_SOURCE, isOriginConnected } from './injected-provider';

const ROOT = path.resolve(__dirname, '..', '..');
const ADDRESS = '0x1111111111111111111111111111111111111111';

function makeWindow(extra: Record<string, unknown> = {}) {
  const target = new EventTarget();
  const win: Record<string, unknown> = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    Event,
    CustomEvent,
    ...extra,
  };
  win.window = win;
  return win;
}

function runInjected(win: Record<string, unknown>) {
  vm.runInNewContext(INJECTED_PROVIDER_SOURCE, win);
}

test('injected provider sets window.ethereum and answers EIP-6963 requests', () => {
  const win = makeWindow();
  runInjected(win);
  const eth = win.ethereum as { isBoreDefi?: boolean; request?: unknown };
  assert.equal(eth?.isBoreDefi, true);
  assert.equal(typeof eth.request, 'function');
  let announced: { info?: { rdns?: string }; provider?: unknown } | null = null;
  (win.addEventListener as EventTarget['addEventListener'])('eip6963:announceProvider', (event) => {
    announced = (event as CustomEvent).detail;
  });
  (win.dispatchEvent as EventTarget['dispatchEvent'])(new Event('eip6963:requestProvider'));
  assert.equal(announced!.info?.rdns, 'com.boredefi.wallet');
  assert.equal(announced!.provider, eth);
});

test('injected provider is idempotent (runs before and after load on iOS)', () => {
  const win = makeWindow();
  runInjected(win);
  const first = win.ethereum;
  runInjected(win);
  assert.equal(win.ethereum, first);
});

test('window.ethereum is still set on WebViews without CustomEvent', () => {
  const noCustom = makeWindow({ CustomEvent: undefined });
  runInjected(noCustom);
  assert.equal((noCustom.ethereum as { isBoreDefi?: boolean })?.isBoreDefi, true);
});

test('wallet browser reads connection state from a ref, not a render closure', () => {
  const src = readFileSync(path.join(ROOT, 'src/screens/BrowserScreen.tsx'), 'utf8');
  assert.match(src, /connectedOriginRef\.current/);
  assert.doesNotMatch(src, /useState<string \| null>\(null\);\s*\n\s*const \[error/);
  assert.doesNotMatch(src, /const \[connectedOrigin, setConnectedOrigin\] = useState/);
  // Connect answers the request before announcing accountsChanged.
  const connect = src.slice(src.indexOf("if (kind === 'connect')"), src.indexOf("if (kind === 'disconnect')"));
  assert.ok(connect.indexOf('resolve(') < connect.indexOf("providerEmitScript('accountsChanged'"));
  assert.equal(isOriginConnected('https://www.boredefi.com', 'https://www.boredefi.com'), true);
  assert.equal(isOriginConnected('https://www.boredefi.com', 'https://boredefi.com'), false);
  assert.equal(isOriginConnected(null, 'https://www.boredefi.com'), false);
});

type El = {
  textContent: string;
  title: string;
  hidden: boolean;
  disabled: boolean;
  href: string;
  classList: { add: () => void; remove: () => void };
  addEventListener: (type: string, fn: () => void) => void;
  click: () => void;
};

function makeEl(): El {
  const handlers: Array<() => void> = [];
  return {
    textContent: '',
    title: '',
    hidden: true,
    disabled: false,
    href: '',
    classList: { add() {}, remove() {} },
    addEventListener(_type, fn) {
      handlers.push(fn);
    },
    click() {
      handlers.forEach((fn) => fn());
    },
  };
}

// Fake in-app provider that reproduces build 12's behaviour exactly: approve -> emit
// accountsChanged, answer eth_requestAccounts, but eth_accounts answers [] once (stale closure).
function racyProvider(emitData = true) {
  const listeners: Record<string, Array<(v: unknown) => void>> = {};
  let staleAccountsLeft = 1;
  return {
    isBoreDefi: true,
    on(event: string, fn: (v: unknown) => void) {
      (listeners[event] ||= []).push(fn);
    },
    async request({ method }: { method: string }) {
      // The fresh eth_accounts answer lands late (after the stale one and its eth_chainId).
      let stale = false;
      if (method === 'eth_accounts' && staleAccountsLeft > 0) {
        staleAccountsLeft -= 1;
        stale = true;
      }
      const late = method === 'eth_accounts' && !stale;
      await new Promise((r) => setTimeout(r, late ? 30 : 1));
      if (method === 'eth_requestAccounts') {
        // Build 12 emits accountsChanged before it answers the request.
        (listeners.accountsChanged || []).forEach((fn) => fn(emitData ? [ADDRESS] : undefined));
        return [ADDRESS];
      }
      if (method === 'eth_accounts') {
        return stale ? [] : [ADDRESS];
      }
      if (method === 'eth_chainId') {
        return '0x1';
      }
      if (method === 'eth_getBalance') {
        return '0x0';
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

async function runConnectPage(source: string, injected: unknown | null, injectDelayMs = 0) {
  const els: Record<string, El> = {};
  const document = {
    getElementById(id: string) {
      return (els[id] ||= makeEl());
    },
  };
  const win = makeWindow({ document, setTimeout, clearInterval, setInterval, TextEncoder });
  if (injected && injectDelayMs === 0) {
    win.ethereum = injected;
  }
  vm.runInNewContext(source, win);
  if (injected && injectDelayMs > 0) {
    setTimeout(() => {
      win.ethereum = injected;
      (win.dispatchEvent as EventTarget['dispatchEvent'])(new Event('ethereum#initialized'));
    }, injectDelayMs);
  }
  els.connect.click();
  await new Promise((r) => setTimeout(r, 400));
  return els;
}

const CONNECT_JS = path.join(ROOT, 'connect/app.js');

test('Connect page survives the iOS eth_accounts race (no null provider.request error)', async () => {
  const els = await runConnectPage(readFileSync(CONNECT_JS, 'utf8'), racyProvider());
  assert.equal(els['error'].textContent, '');
  assert.equal(els['status-label'].textContent, 'Connected');
  assert.match(els['address'].textContent, /^0x1111/);
});

test('Connect page survives the race even when accountsChanged carries no data', async () => {
  const els = await runConnectPage(readFileSync(CONNECT_JS, 'utf8'), racyProvider(false));
  assert.equal(els['error'].textContent, '');
  assert.equal(els['status-label'].textContent, 'Connected');
});

test('Connect page waits for a provider injected a moment after load', async () => {
  const els = await runConnectPage(readFileSync(CONNECT_JS, 'utf8'), racyProvider(), 150);
  assert.equal(els['status-label'].textContent, 'Connected');
});

test('the build-12 Connect page really did crash on that race (guards this test itself)', async (t) => {
  let old: string;
  try {
    old = execFileSync('git', ['show', '696c1f0:connect/app.js'], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    t.skip('git history not available');
    return;
  }
  const els = await runConnectPage(old, racyProvider());
  // Same state as Patrick's screenshot: "Disconnected." plus a raw null provider.request error.
  assert.equal(els['message'].textContent, 'Disconnected.');
  assert.match(els['error'].textContent, /null|provider\.request/);
});

test('Connect page copy has no test-page leftovers', () => {
  const html = readFileSync(path.join(ROOT, 'connect/index.html'), 'utf8');
  assert.doesNotMatch(html, /TEST-ONLY|Throwaway|test signature|Sign test message/i);
  assert.doesNotMatch(html, /pwiggle|github/i);
  assert.doesNotMatch(html, /™|&trade;/);
});
