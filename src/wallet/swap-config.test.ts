import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { nativeSwapEnabled } from './swap-config';

test('native swap is on unless EXPO_PUBLIC_NATIVE_SWAP is 0 or false', () => {
  assert.equal(nativeSwapEnabled(undefined), true);
  assert.equal(nativeSwapEnabled(''), true);
  assert.equal(nativeSwapEnabled('1'), true);
  assert.equal(nativeSwapEnabled('true'), true);
  assert.equal(nativeSwapEnabled('0'), false);
  assert.equal(nativeSwapEnabled('false'), false);
});

test('preview, testflight-swap and production (1.0.10) turn native swap on', () => {
  const eas = JSON.parse(readFileSync(new URL('../../eas.json', import.meta.url), 'utf8')) as {
    build: {
      preview?: { env?: Record<string, string>; android?: { buildType?: string } };
      production: { env?: Record<string, string> };
      'testflight-swap'?: { env?: Record<string, string>; ios?: { distribution?: string } };
    };
  };
  const preview = eas.build.preview?.env ?? {};
  const testflight = eas.build['testflight-swap']?.env ?? {};
  const production = eas.build.production.env ?? {};
  assert.equal(preview.EXPO_PUBLIC_NATIVE_SWAP, '1');
  assert.equal(preview.EXPO_PUBLIC_SOLANA, '1');
  assert.equal(eas.build.preview?.android?.buildType, 'apk');
  assert.equal(testflight.EXPO_PUBLIC_NATIVE_SWAP, '1');
  assert.equal(testflight.EXPO_PUBLIC_SOLANA, '1');
  assert.equal(eas.build['testflight-swap']?.ios?.distribution, 'store');
  assert.equal(production.EXPO_PUBLIC_NATIVE_SWAP, '1');
  assert.equal(production.EXPO_PUBLIC_SOLANA, '1');
  assert.equal(production.EXPO_PUBLIC_BUY_CRYPTO, '1');
  assert.equal(production.EXPO_PUBLIC_ONRAMP_URL, 'https://pay.boredefi.com/api/onramp-session');
  assert.equal(nativeSwapEnabled(preview.EXPO_PUBLIC_NATIVE_SWAP), true);
  assert.equal(nativeSwapEnabled(testflight.EXPO_PUBLIC_NATIVE_SWAP), true);
  assert.equal(nativeSwapEnabled(production.EXPO_PUBLIC_NATIVE_SWAP), true);
});
