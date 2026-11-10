import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getAddress } from 'ethers';

import {
  TRANSAK_PARTNER_FEE_PERCENT,
  TRANSAK_PRODUCTION_HOST,
  TRANSAK_REFERRER_DOMAIN,
  TRANSAK_STAGING_HOST,
  buildTransakWidgetUrl,
  isTransakFeeQueryParam,
  isTransakHostedWidgetUrl,
  isTransakPlaceholder,
  transakApiKey,
  transakCryptoForOffer,
  transakEnvironment,
  transakHost,
} from './transak';
import { findOnrampOffer } from './offers';

const EVM = getAddress('0x9858effd232b4033e47d90003d41ec34ecaeda94');
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const KEY = 'staging-transak-key-unit';

test('the Transak key and environment are read with literal process.env so Expo can inline them', () => {
  const src = readFileSync(new URL('./transak.ts', import.meta.url), 'utf8');
  assert.match(src, /=\s*process\.env\.EXPO_PUBLIC_TRANSAK_API_KEY;/);
  assert.match(src, /=\s*process\.env\.EXPO_PUBLIC_TRANSAK_ENVIRONMENT;/);
  assert.doesNotMatch(src, /STRIPE_SECRET|sk_live_|sk_test_|api-secret|apiSecret/i);
  assert.equal(TRANSAK_PARTNER_FEE_PERCENT, 0);
});

test('placeholders and secret-looking values never become a Transak API key', () => {
  assert.equal(isTransakPlaceholder(undefined), true);
  assert.equal(isTransakPlaceholder(''), true);
  assert.equal(isTransakPlaceholder('  REPLACE_ME  '), true);
  assert.equal(isTransakPlaceholder('YOUR_API_KEY'), true);
  assert.equal(transakApiKey(undefined), null);
  assert.equal(transakApiKey('short'), null);
  assert.equal(transakApiKey('sk_live_should_never_ship'), null);
  assert.equal(transakApiKey('  staging-transak-key-unit  '), KEY);
});

test('staging is the default environment and production is opt-in', () => {
  assert.equal(transakEnvironment(undefined), 'STAGING');
  assert.equal(transakEnvironment('staging'), 'STAGING');
  assert.equal(transakEnvironment('PRODUCTION'), 'PRODUCTION');
  assert.equal(transakHost('STAGING'), TRANSAK_STAGING_HOST);
  assert.equal(transakHost('PRODUCTION'), TRANSAK_PRODUCTION_HOST);
});

test('offers map onto Transak cryptoCurrencyCode and network, with POL for Polygon', () => {
  const eth = findOnrampOffer('eth', 'base');
  const pol = findOnrampOffer('matic', 'polygon');
  const sol = findOnrampOffer('usdc', 'solana');
  assert.ok(eth && pol && sol);
  assert.deepEqual(transakCryptoForOffer(eth), { cryptoCurrencyCode: 'ETH', network: 'base' });
  assert.deepEqual(transakCryptoForOffer(pol), { cryptoCurrencyCode: 'POL', network: 'polygon' });
  assert.deepEqual(transakCryptoForOffer(sol), { cryptoCurrencyCode: 'USDC', network: 'solana' });
});

test('the widget URL prefills the user’s address and network, locks the address, and charges no partner fee', () => {
  const eth = buildTransakWidgetUrl({
    apiKey: KEY,
    offerId: 'eth-base',
    evmAddress: `  ${EVM}  `,
    solanaAddress: SOL,
  });
  assert.equal(eth.ok, true);
  if (!eth.ok) {
    return;
  }
  const url = new URL(eth.url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, TRANSAK_STAGING_HOST);
  assert.equal(url.searchParams.get('apiKey'), KEY);
  assert.equal(url.searchParams.get('environment'), 'STAGING');
  assert.equal(url.searchParams.get('productsAvailed'), 'BUY');
  assert.equal(url.searchParams.get('cryptoCurrencyCode'), 'ETH');
  assert.equal(url.searchParams.get('network'), 'base');
  assert.equal(url.searchParams.get('walletAddress'), EVM);
  assert.equal(url.searchParams.get('disableWalletAddressForm'), 'true');
  assert.equal(url.searchParams.get('referrerDomain'), TRANSAK_REFERRER_DOMAIN);
  for (const name of url.searchParams.keys()) {
    assert.equal(isTransakFeeQueryParam(name), false, name);
  }
  assert.equal(url.searchParams.get('partnerFee'), null);
  assert.equal(url.searchParams.get('partnerFeePercent'), null);
  assert.equal(url.searchParams.get('feePercentage'), null);
  assert.equal(isTransakHostedWidgetUrl(eth.url), true);

  const sol = buildTransakWidgetUrl({
    apiKey: KEY,
    environment: 'PRODUCTION',
    offerId: 'usdc-solana',
    evmAddress: EVM,
    solanaAddress: SOL,
  });
  assert.equal(sol.ok, true);
  if (sol.ok) {
    const solUrl = new URL(sol.url);
    assert.equal(solUrl.hostname, TRANSAK_PRODUCTION_HOST);
    assert.equal(solUrl.searchParams.get('environment'), 'PRODUCTION');
    assert.equal(solUrl.searchParams.get('walletAddress'), SOL);
    assert.equal(solUrl.searchParams.get('cryptoCurrencyCode'), 'USDC');
    assert.equal(solUrl.searchParams.get('network'), 'solana');
  }

  const pol = buildTransakWidgetUrl({
    apiKey: KEY,
    offerId: 'matic-polygon',
    evmAddress: EVM,
    solanaAddress: null,
  });
  assert.equal(pol.ok, true);
  if (pol.ok) {
    assert.equal(new URL(pol.url).searchParams.get('cryptoCurrencyCode'), 'POL');
  }

  assert.equal(
    buildTransakWidgetUrl({ apiKey: 'REPLACE_ME', offerId: 'eth-ethereum', evmAddress: EVM, solanaAddress: null }).ok,
    false,
  );
  assert.equal(
    buildTransakWidgetUrl({ apiKey: KEY, offerId: 'sol-solana', evmAddress: EVM, solanaAddress: null }).ok,
    false,
  );
});

test('only the official Transak widget hosts are accepted', () => {
  const ok = `https://${TRANSAK_STAGING_HOST}/?apiKey=${KEY}`;
  assert.equal(isTransakHostedWidgetUrl(ok), true);
  assert.equal(isTransakHostedWidgetUrl(`https://${TRANSAK_PRODUCTION_HOST}/?apiKey=${KEY}`), true);
  assert.equal(isTransakHostedWidgetUrl(`http://${TRANSAK_STAGING_HOST}/?apiKey=${KEY}`), false);
  assert.equal(isTransakHostedWidgetUrl(`https://${TRANSAK_STAGING_HOST}.evil.test/?apiKey=${KEY}`), false);
  assert.equal(isTransakHostedWidgetUrl('https://evil.test/?next=https://global-stg.transak.com'), false);
  assert.equal(isTransakHostedWidgetUrl(`https://user:pass@${TRANSAK_STAGING_HOST}/?apiKey=${KEY}`), false);
  assert.equal(isTransakHostedWidgetUrl(`https://${TRANSAK_STAGING_HOST}/`), false);
  assert.equal(isTransakFeeQueryParam('partnerFeePercent'), true);
  assert.equal(isTransakFeeQueryParam('apiKey'), false);
});

test('the Transak module and Buy screen never read a seed or private key, and charge no BoreDefi fee', () => {
  const src = readFileSync(new URL('./transak.ts', import.meta.url), 'utf8');
  const open = readFileSync(new URL('./open.ts', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../../screens/BuyScreen.tsx', import.meta.url), 'utf8');
  const docs = readFileSync(new URL('./TRANSAK.md', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /mnemonic|privateKey|seed|STRIPE_SECRET|sk_live|sk_test_/i);
  assert.match(open, /openTransakHostedWidget/);
  assert.match(open, /openBrowserAsync/);
  assert.doesNotMatch(open, /webview/i);
  assert.doesNotMatch(screen, /webview/i);
  assert.match(screen, /Continue with Transak/);
  assert.match(screen, /does not charge a fee/);
  assert.match(docs, /dashboard\.transak\.com/);
  assert.match(docs, /forms\.transak\.com\/kyb/);
  assert.match(docs, /0%/);
  assert.doesNotMatch(docs, /640ebc069e89e5691aad/i);
});
