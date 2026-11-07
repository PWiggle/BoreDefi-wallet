import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BUY_CRYPTO_ENABLED, buyCryptoEnabled, isAllowedOnrampEndpoint, onrampAppToken, onrampEndpointUrl } from './config';

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
  assert.doesNotMatch(src, /STRIPE_SECRET|sk_live|sk_test_/);
});

test('store profile does not turn Buy crypto on', () => {
  const eas = JSON.parse(readFileSync(new URL('../../../eas.json', import.meta.url), 'utf8')) as {
    build: { production: { env?: Record<string, string> } };
  };
  assert.notEqual(eas.build.production.env?.EXPO_PUBLIC_BUY_CRYPTO, '1');
  assert.notEqual(eas.build.production.env?.EXPO_PUBLIC_BUY_CRYPTO, 'true');
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
