import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getAddress } from 'ethers';

import {
  TRANSAK_PARTNER_FEE_PERCENT,
  TRANSAK_PRODUCTION_HOST,
  TRANSAK_REFERRER_DOMAIN,
  TRANSAK_STAGING_HOST,
  buildTransakWidgetRequest,
  isAllowedTransakWidgetEndpoint,
  isTransakFeeQueryParam,
  isTransakHostedWidgetUrl,
  isTransakPlaceholder,
  postTransakWidgetUrl,
  readTransakWidgetUrl,
  transakCryptoForOffer,
  transakWidgetEndpointUrl,
} from './transak';
import { findOnrampOffer } from './offers';

const EVM = getAddress('0x9858effd232b4033e47d90003d41ec34ecaeda94');
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

test('the Transak endpoint is read with a literal process.env so Expo can inline it', () => {
  const src = readFileSync(new URL('./transak.ts', import.meta.url), 'utf8');
  assert.match(src, /=\s*process\.env\.EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT;/);
  assert.doesNotMatch(src, /STRIPE_SECRET|sk_live_|sk_test_|api-secret|apiSecret|TRANSAK_API_SECRET/i);
  assert.equal(TRANSAK_PARTNER_FEE_PERCENT, 0);
  assert.equal(TRANSAK_REFERRER_DOMAIN, 'com.boredefi.wallet');
});

test('placeholders never become a Transak widget endpoint', () => {
  assert.equal(isTransakPlaceholder(undefined), true);
  assert.equal(isTransakPlaceholder(''), true);
  assert.equal(isTransakPlaceholder('  REPLACE_ME  '), true);
  assert.equal(transakWidgetEndpointUrl(undefined), null);
  assert.equal(transakWidgetEndpointUrl('https://REPLACE_ME/api/widget-url'), null);
  assert.equal(transakWidgetEndpointUrl('https://preview.example'), 'https://preview.example/api/widget-url');
  assert.equal(
    transakWidgetEndpointUrl('https://preview.example/api/widget-url?x=1'),
    'https://preview.example/api/widget-url',
  );
  assert.equal(transakWidgetEndpointUrl('http://127.0.0.1:8788/'), 'http://127.0.0.1:8788/api/widget-url');
  assert.equal(transakWidgetEndpointUrl('http://localhost:8788'), 'http://localhost:8788/api/widget-url');
  assert.equal(isAllowedTransakWidgetEndpoint('https://preview.example/api/widget-url'), true);
  assert.equal(isAllowedTransakWidgetEndpoint('http://10.0.0.5/api/widget-url'), false);
  assert.equal(transakWidgetEndpointUrl('https://user:pass@preview.example'), null);
});

test('offers map onto Transak crypto and network, with POL for Polygon', () => {
  const eth = findOnrampOffer('eth', 'base');
  const pol = findOnrampOffer('matic', 'polygon');
  const sol = findOnrampOffer('usdc', 'solana');
  assert.ok(eth && pol && sol);
  assert.deepEqual(transakCryptoForOffer(eth), { crypto: 'ETH', network: 'base' });
  assert.deepEqual(transakCryptoForOffer(pol), { crypto: 'POL', network: 'polygon' });
  assert.deepEqual(transakCryptoForOffer(sol), { crypto: 'USDC', network: 'solana' });
});

test('the widget request sends only the public address, asset, and network, and no partner fee', () => {
  const eth = buildTransakWidgetRequest({
    offerId: 'eth-base',
    evmAddress: `  ${EVM}  `,
    solanaAddress: SOL,
  });
  assert.equal(eth.ok, true);
  if (!eth.ok) {
    return;
  }
  assert.deepEqual(eth.body, { walletAddress: EVM, network: 'base', crypto: 'ETH' });
  assert.deepEqual(Object.keys(eth.body).sort(), ['crypto', 'network', 'walletAddress']);

  const sol = buildTransakWidgetRequest({
    offerId: 'usdc-solana',
    evmAddress: EVM,
    solanaAddress: SOL,
    fiatAmount: 40,
  });
  assert.equal(sol.ok, true);
  if (sol.ok) {
    assert.deepEqual(sol.body, { walletAddress: SOL, network: 'solana', crypto: 'USDC', fiatAmount: 40 });
  }

  const pol = buildTransakWidgetRequest({
    offerId: 'matic-polygon',
    evmAddress: EVM,
    solanaAddress: null,
  });
  assert.equal(pol.ok, true);
  if (pol.ok) {
    assert.equal(pol.body.crypto, 'POL');
  }

  assert.equal(buildTransakWidgetRequest({ offerId: 'sol-solana', evmAddress: EVM, solanaAddress: null }).ok, false);
  assert.equal(buildTransakWidgetRequest({ offerId: 'eth-ethereum', evmAddress: SOL, solanaAddress: SOL }).ok, false);
});

test('posted JSON is only those fields, and a non-Transak redirect is dropped', async () => {
  const built = buildTransakWidgetRequest({ offerId: 'usdc-ethereum', evmAddress: EVM, solanaAddress: null });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const widgetUrl = `https://${TRANSAK_STAGING_HOST}/?apiKey=unit&sessionId=session-unit`;
  let captured = '';
  const ok = await postTransakWidgetUrl({
    endpoint: 'https://preview.example/api/widget-url',
    body: built.body,
    fetchImpl: async (_url, init) => {
      captured = String(init?.body ?? '');
      return new Response(JSON.stringify({ widgetUrl, accessToken: 'should-not-leak' }), { status: 200 });
    },
  });
  assert.deepEqual(JSON.parse(captured), built.body);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.widgetUrl, widgetUrl);
    assert.deepEqual(Object.keys(ok).sort().join(), 'ok,widgetUrl');
    assert.doesNotMatch(JSON.stringify(ok), /accessToken|apiSecret/);
  }

  const phish = await postTransakWidgetUrl({
    endpoint: 'https://preview.example/api/widget-url',
    body: built.body,
    fetchImpl: async () => new Response(JSON.stringify({ widgetUrl: 'https://global-stg.transak.com.evil.test/?sessionId=x' }), { status: 200 }),
  });
  assert.equal(phish.ok, false);

  const fee = await postTransakWidgetUrl({
    endpoint: 'https://preview.example/api/widget-url',
    body: built.body,
    fetchImpl: async () =>
      new Response(JSON.stringify({ widgetUrl: `https://${TRANSAK_STAGING_HOST}/?sessionId=x&partnerFee=1` }), { status: 200 }),
  });
  assert.equal(fee.ok, false);

  const insecure = await postTransakWidgetUrl({
    endpoint: 'http://10.1.2.3/api/widget-url',
    body: built.body,
    fetchImpl: async () => {
      throw new Error('should not fetch');
    },
  });
  assert.equal(insecure.ok, false);

  const rejected = await postTransakWidgetUrl({
    endpoint: 'https://preview.example/api/widget-url',
    body: built.body,
    fetchImpl: async () => new Response(JSON.stringify({ error: 'Too many buy requests. Try again in a minute.' }), { status: 429 }),
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.match(rejected.error, /Too many buy requests/);
  }
});

test('only the official Transak widget hosts are accepted', () => {
  const ok = `https://${TRANSAK_STAGING_HOST}/?apiKey=unit&sessionId=session-unit`;
  assert.equal(isTransakHostedWidgetUrl(ok), true);
  assert.equal(isTransakHostedWidgetUrl(`https://${TRANSAK_PRODUCTION_HOST}/?sessionId=session-unit`), true);
  assert.equal(isTransakHostedWidgetUrl(`http://${TRANSAK_STAGING_HOST}/?sessionId=x`), false);
  assert.equal(isTransakHostedWidgetUrl(`https://${TRANSAK_STAGING_HOST}.evil.test/?sessionId=x`), false);
  assert.equal(isTransakHostedWidgetUrl('https://evil.test/?next=https://global-stg.transak.com'), false);
  assert.equal(isTransakHostedWidgetUrl(`https://user:pass@${TRANSAK_STAGING_HOST}/?sessionId=x`), false);
  assert.equal(isTransakHostedWidgetUrl(`https://${TRANSAK_STAGING_HOST}/`), false);
  assert.equal(isTransakHostedWidgetUrl(`https://${TRANSAK_STAGING_HOST}/?apiKey=unit&partnerFee=1`), false);
  assert.equal(isTransakFeeQueryParam('partnerFeePercent'), true);
  assert.equal(isTransakFeeQueryParam('apiKey'), false);
  assert.equal(readTransakWidgetUrl({ widgetUrl: ok }).ok, true);
  assert.equal(readTransakWidgetUrl({ widgetUrl: 'https://wallet-phishing.test' }).ok, false);
});

test('the Transak module and Buy screen never read a seed or private key, and charge no BoreDefi fee', () => {
  const src = readFileSync(new URL('./transak.ts', import.meta.url), 'utf8');
  const open = readFileSync(new URL('./open.ts', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../../screens/BuyScreen.tsx', import.meta.url), 'utf8');
  const docs = readFileSync(new URL('./TRANSAK.md', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /mnemonic|privateKey|seed|STRIPE_SECRET|sk_live|sk_test_|TRANSAK_API_SECRET/i);
  assert.match(open, /openTransakHostedWidget/);
  assert.match(open, /openBrowserAsync/);
  assert.doesNotMatch(open, /webview/i);
  assert.match(open, /Do not open the\n \* widget with rel=noreferrer/);
  assert.doesNotMatch(screen, /webview/i);
  assert.match(screen, /Continue with Transak/);
  assert.match(screen, /does not charge a fee/);
  assert.match(screen, /postTransakWidgetUrl/);
  assert.match(docs, /dashboard\.transak\.com/);
  assert.match(docs, /forms\.transak\.com\/kyb/);
  assert.match(docs, /0%/);
  assert.match(docs, /EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT/);
  assert.doesNotMatch(docs, /640ebc069e89e5691aad/i);
});

test('production hides Transak: no endpoint in eas.json, and the Buy screen renders no Transak picker or setup notice without it', () => {
  const eas = JSON.parse(readFileSync(new URL('../../../eas.json', import.meta.url), 'utf8')) as {
    build: { production: { env?: Record<string, string> } };
  };
  assert.equal(eas.build.production.env?.EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT, undefined);
  assert.equal(transakWidgetEndpointUrl(undefined), null);
  assert.equal(transakWidgetEndpointUrl(''), null);
  const screen = readFileSync(new URL('../../screens/BuyScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /\{TRANSAK_BUY_AVAILABLE \? \(\s*<>\s*<Text style=\{styles\.label\}>Pay with<\/Text>/);
  assert.doesNotMatch(screen, /Transak is not in this build yet/);
});
