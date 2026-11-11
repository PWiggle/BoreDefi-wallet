import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createClipboardGuard, type ClearMode } from './clipboard-guard';
import { normalizeDappUrl, webViewSchemePolicy } from './dapps';
import { clearWalletCache, walletCacheSize, walletFromMnemonic } from './mnemonic';

const PHRASE = 'test test test test test test test test test test test junk';

test('ETH key cache is emptied by clearWalletCache (called on lock and reset)', async () => {
  await walletFromMnemonic(PHRASE);
  assert.ok(walletCacheSize() > 0);
  clearWalletCache();
  assert.equal(walletCacheSize(), 0);
});

test('typed http:// URLs open as https://', () => {
  assert.equal(normalizeDappUrl('http://app.aave.com/x'), 'https://app.aave.com/x');
  assert.equal(normalizeDappUrl('HTTP://Example.com'), 'https://Example.com');
  assert.equal(normalizeDappUrl('localhost:8080'), 'https://localhost:8080');
  assert.throws(() => normalizeDappUrl('javascript:alert(1)'), /https/);
  assert.throws(() => normalizeDappUrl('file:///etc/hosts'), /https/);
});

test('WebView scheme policy: https only, http upgraded, raw pages and other schemes blocked', () => {
  assert.deepEqual(webViewSchemePolicy('https://app.aave.com'), { action: 'allow' });
  assert.deepEqual(webViewSchemePolicy('http://evil.xyz/a?b=1'), { action: 'upgrade', url: 'https://evil.xyz/a?b=1' });
  assert.equal(webViewSchemePolicy('http://evil.xyz', false).action, 'block');
  assert.equal(webViewSchemePolicy('data:text/html,<h1>x</h1>').action, 'block');
  assert.equal(webViewSchemePolicy('data:text/html,x', false).action, 'allow');
  assert.equal(webViewSchemePolicy('blob:https://a.com/1').action, 'block');
  assert.equal(webViewSchemePolicy('about:blank').action, 'allow');
  assert.equal(webViewSchemePolicy('about:config').action, 'block');
  assert.equal(webViewSchemePolicy('javascript:alert(1)').action, 'block');
  assert.equal(webViewSchemePolicy('file:///data/data/x').action, 'block');
});

function fakeClipboard(initial = '') {
  let value = initial;
  const fired: (() => void)[] = [];
  const api = {
    setStringAsync: async (t: string) => {
      value = t;
      return true;
    },
    getStringAsync: async () => value,
  };
  return {
    api,
    get value() {
      return value;
    },
    set value(v: string) {
      value = v;
    },
    schedule: (fn: () => void) => {
      fired.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    async fire() {
      fired.shift()?.();
      await new Promise((r) => setImmediate(r));
    },
  };
}

test('clipboard: copied text is wiped after the timer (compare mode, Android)', async () => {
  const clip = fakeClipboard();
  const guard = createClipboardGuard(clip.api, { schedule: clip.schedule, cancel: () => undefined });
  await guard.copy('0xabc');
  assert.equal(clip.value, '0xabc');
  await clip.fire();
  assert.equal(clip.value, '');
});

test('clipboard: something the user copied later is left alone', async () => {
  const clip = fakeClipboard();
  const guard = createClipboardGuard(clip.api, { schedule: clip.schedule, cancel: () => undefined });
  await guard.copy('0xabc');
  clip.value = 'my note';
  await clip.fire();
  assert.equal(clip.value, 'my note');
});

test('clipboard: iOS clears blind only when told, and skips otherwise', async () => {
  let mode: ClearMode = 'blind';
  const clip = fakeClipboard();
  const guard = createClipboardGuard(clip.api, { schedule: clip.schedule, cancel: () => undefined, clearMode: () => mode });
  await guard.copy('0xabc');
  await clip.fire();
  assert.equal(clip.value, '');
  mode = 'skip';
  await guard.copy('0xdef');
  await clip.fire();
  assert.equal(clip.value, '0xdef');
});

test('Android hardening: no backup, no device transfer, narrow FileProvider paths', async () => {
  const app = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8'));
  assert.equal(app.expo.android.allowBackup, false);
  assert.ok(app.expo.plugins.includes('./plugins/withAndroidHardening'));
  const secureStore = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-secure-store');
  assert.equal(secureStore?.[1]?.configureAndroidBackup, false);
  const ats = app.expo.ios.infoPlist.NSAppTransportSecurity;
  assert.equal(ats.NSAllowsArbitraryLoads, false);
  assert.equal(ats.NSAllowsArbitraryLoadsInWebContent, false);
  const { FILES } = (await import('../../plugins/withAndroidHardening.js')) as unknown as {
    FILES: Record<string, string>;
  };
  assert.doesNotMatch(FILES['file_provider_paths.xml'] ?? '', /<external-path/);
  assert.match(FILES['file_system_provider_paths.xml'] ?? '', /path="share\/"/);
  for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
    assert.match(FILES['boredefi_data_extraction_rules.xml'] ?? '', new RegExp(`exclude domain="${domain}"`));
  }
  assert.match(FILES['boredefi_data_extraction_rules.xml'] ?? '', /<device-transfer>/);
});
