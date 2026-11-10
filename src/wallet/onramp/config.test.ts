import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BUY_CRYPTO_ENABLED,
  buyCryptoEnabled,
  buyCryptoVisible,
  isAllowedOnrampEndpoint,
  onrampAppToken,
  onrampEndpointUrl,
  vercelBypassToken,
} from './config';

test('Buy crypto is off in release builds unless EXPO_PUBLIC_BUY_CRYPTO turns it on', () => {
  assert.equal(buyCryptoEnabled(undefined, false), false);
  assert.equal(buyCryptoEnabled('', false), false);
  assert.equal(buyCryptoEnabled(undefined, true), true);
  assert.equal(buyCryptoEnabled('1', false), true);
  assert.equal(buyCryptoEnabled('true', false), true);
  assert.equal(buyCryptoEnabled('0', true), false);
  assert.equal(buyCryptoEnabled('false', true), false);
  assert.equal(BUY_CRYPTO_ENABLED, process.env.EXPO_PUBLIC_BUY_CRYPTO === '1' || process.env.EXPO_PUBLIC_BUY_CRYPTO === 'true');
});

test('the flag and endpoint are read with literal process.env so Expo can inline them', () => {
  const src = readFileSync(new URL('./config.ts', import.meta.url), 'utf8');
  assert.match(src, /=\s*process\.env\.EXPO_PUBLIC_BUY_CRYPTO;/);
  assert.match(src, /=\s*process\.env\.EXPO_PUBLIC_ONRAMP_URL;/);
  assert.match(src, /=\s*process\.env\.EXPO_PUBLIC_ONRAMP_TOKEN;/);
  assert.match(src, /=\s*process\.env\.EXPO_PUBLIC_VERCEL_BYPASS;/);
  assert.doesNotMatch(src, /STRIPE_SECRET|sk_live_|sk_test_/);
  const transakSrc = readFileSync(new URL('./transak.ts', import.meta.url), 'utf8');
  assert.match(transakSrc, /=\s*process\.env\.EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT;/);
});

test('production turns Buy on against the live pay.boredefi.com endpoint', () => {
  const eas = JSON.parse(readFileSync(new URL('../../../eas.json', import.meta.url), 'utf8')) as {
    build: {
      development?: { env?: Record<string, string> };
      preview?: { env?: Record<string, string> };
      'testflight-transak'?: { env?: Record<string, string>; ios?: { distribution?: string } };
      production: { env?: Record<string, string> };
    };
  };
  const production = eas.build.production.env ?? {};
  const development = eas.build.development?.env ?? {};
  const preview = eas.build.preview?.env ?? {};
  assert.equal(development.EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT, 'https://boredefi-transak-api.vercel.app/api/widget-url');
  assert.equal(preview.EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT, 'https://boredefi-transak-api.vercel.app/api/widget-url');
  const testflight = eas.build['testflight-transak']?.env ?? {};
  assert.equal(testflight.EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT, 'https://boredefi-transak-api.vercel.app/api/widget-url');
  assert.equal(eas.build['testflight-transak']?.ios?.distribution, 'store');
  assert.equal(production.EXPO_PUBLIC_BUY_CRYPTO, '1');
  assert.equal(production.EXPO_PUBLIC_ONRAMP_URL, 'https://pay.boredefi.com/api/onramp-session');
  assert.equal(production.EXPO_PUBLIC_VERCEL_BYPASS, undefined);
  assert.equal(production.EXPO_PUBLIC_TRANSAK_API_KEY, undefined);
  assert.equal(production.EXPO_PUBLIC_TRANSAK_ENVIRONMENT, undefined);
  assert.equal(production.EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT, undefined);
  assert.equal(buyCryptoVisible('1', false, production.EXPO_PUBLIC_ONRAMP_URL), true);
  assert.equal(buyCryptoVisible('1', false, 'https://REPLACE_ME/api/onramp-session'), false);
  assert.equal(buyCryptoVisible('1', false, undefined), false);
  assert.equal(buyCryptoVisible('1', false, 'https://onramp.example'), true);
  assert.equal(buyCryptoVisible('0', true, 'https://onramp.example'), false);
  assert.equal(onrampEndpointUrl('https://REPLACE_ME/api/onramp-session'), null);
  assert.equal(vercelBypassToken(undefined), null);
  assert.equal(vercelBypassToken('   '), null);
  assert.equal(vercelBypassToken(' bypass-token '), 'bypass-token');
});

test('Buy is visible when Transak is ready even if the Stripe URL is missing', () => {
  assert.equal(buyCryptoVisible('1', false, undefined, false), false);
  assert.equal(buyCryptoVisible('1', false, undefined, true), true);
  assert.equal(buyCryptoVisible('1', false, 'https://REPLACE_ME/api/onramp-session', true), true);
  assert.equal(buyCryptoVisible('1', false, 'https://onramp.example', false), true);
  assert.equal(buyCryptoVisible('0', true, undefined, true), false);
});

test('endpoint base URL must be https, or loopback, and always targets the session path', () => {
  assert.equal(onrampEndpointUrl(undefined), null);
  assert.equal(onrampEndpointUrl('http://evil.example'), null);
  assert.equal(onrampEndpointUrl('https://user:pass@preview.example'), null);
  assert.equal(onrampEndpointUrl('https://preview.example'), 'https://preview.example/api/onramp-session');
  assert.equal(onrampEndpointUrl('https://preview.example/api/onramp-session?x=1'), 'https://preview.example/api/onramp-session');
  assert.equal(onrampEndpointUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787/api/onramp-session');
  assert.equal(onrampEndpointUrl('http://localhost:8787'), 'http://localhost:8787/api/onramp-session');
  assert.equal(isAllowedOnrampEndpoint('https://preview.example/api/onramp-session'), true);
  assert.equal(isAllowedOnrampEndpoint('http://10.0.0.5/api/onramp-session'), false);
  assert.equal(onrampAppToken('  '), null);
  assert.equal(onrampAppToken(' abc '), 'abc');
});
