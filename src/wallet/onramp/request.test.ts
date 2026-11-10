import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getAddress } from 'ethers';

import { ONRAMP_OFFERS, assetChoices, findOnrampOffer, initialOffer, offersForAsset, offersForWallet } from './offers';
import { buildOnrampSessionRequest, postOnrampSession, readOnrampRedirect } from './request';
import { isStripeHostedOnrampUrl } from './url';

const EVM = getAddress('0x9858effd232b4033e47d90003d41ec34ecaeda94');
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

test('offers are the wallet networks Stripe’s hosted onramp can pay, and nothing else', () => {
  const ids = ONRAMP_OFFERS.map((offer) => offer.id);
  assert.deepEqual(ids, [
    'eth-ethereum',
    'usdc-ethereum',
    'eth-base',
    'usdc-base',
    'matic-polygon',
    'usdc-polygon',
    'sol-solana',
    'usdc-solana',
  ]);
  assert.equal(findOnrampOffer('btc', 'bitcoin'), undefined);
  assert.equal(findOnrampOffer('eth', 'solana'), undefined);
  assert.equal(findOnrampOffer('usdc', 'optimism'), undefined);
  assert.equal(findOnrampOffer('avax', 'avalanche'), undefined);
  assert.equal(findOnrampOffer('usdc', 'avalanche'), undefined);
  assert.equal(offersForWallet(false).some((offer) => offer.family === 'solana'), false);
  assert.equal(offersForWallet(true).some((offer) => offer.id === 'sol-solana'), true);
  assert.equal(initialOffer(offersForWallet(false), 8453).id, 'eth-base');
  assert.equal(initialOffer(offersForWallet(false), 137).id, 'matic-polygon');
  assert.equal(initialOffer(offersForWallet(false), 43114).id, 'eth-ethereum');
  assert.deepEqual(assetChoices(offersForWallet(false)), ['ETH', 'USDC', 'POL']);
  assert.deepEqual(
    offersForAsset(ONRAMP_OFFERS, 'USDC').map((offer) => offer.network),
    ['ethereum', 'base', 'polygon', 'solana'],
  );
});

test('the request body is the public address for the selected network and nothing else', () => {
  const eth = buildOnrampSessionRequest({ offerId: 'eth-base', evmAddress: `  ${EVM}  `, solanaAddress: SOL });
  assert.equal(eth.ok, true);
  if (!eth.ok) {
    return;
  }
  assert.deepEqual(eth.body, { destination_currency: 'eth', destination_network: 'base', wallet_address: EVM });
  assert.deepEqual(Object.keys(eth.body).sort(), ['destination_currency', 'destination_network', 'wallet_address']);

  const sol = buildOnrampSessionRequest({ offerId: 'usdc-solana', evmAddress: EVM, solanaAddress: SOL });
  assert.equal(sol.ok, true);
  if (sol.ok) {
    assert.equal(sol.body.wallet_address, SOL);
    assert.equal(sol.body.destination_network, 'solana');
  }

  const missingSol = buildOnrampSessionRequest({ offerId: 'sol-solana', evmAddress: EVM, solanaAddress: null });
  assert.equal(missingSol.ok, false);

  const swapped = buildOnrampSessionRequest({ offerId: 'eth-ethereum', evmAddress: SOL, solanaAddress: SOL });
  assert.equal(swapped.ok, false);

  const encoded = JSON.stringify(eth.body);
  assert.doesNotMatch(encoded, /mnemonic|seed|private/i);
});

test('posted JSON is only those three fields, and a non-Stripe redirect is dropped', async () => {
  const built = buildOnrampSessionRequest({ offerId: 'usdc-ethereum', evmAddress: EVM, solanaAddress: null });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  let captured = '';
  let header = '';
  const ok = await postOnrampSession({
    endpoint: 'https://preview.example/api/onramp-session',
    body: built.body,
    appToken: '  public-token  ',
    fetchImpl: async (_url, init) => {
      captured = String(init?.body ?? '');
      const headers = new Headers(init?.headers);
      header = headers.get('x-boredefi-onramp') ?? '';
      assert.equal(headers.get('x-vercel-protection-bypass'), null);
      return new Response(
        JSON.stringify({
          redirect_url: 'https://crypto.link.com?session_hash=unit',
          client_secret: 'cos_secret_should_not_leak',
        }),
        { status: 200 },
      );
    },
  });
  assert.deepEqual(JSON.parse(captured), built.body);
  assert.equal(header, 'public-token');
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(Object.keys(ok).sort().join(), 'ok,redirectUrl');
    assert.doesNotMatch(JSON.stringify(ok), /client_secret/);
  }

  const phish = await postOnrampSession({
    endpoint: 'https://preview.example/api/onramp-session',
    body: built.body,
    appToken: null,
    fetchImpl: async () => new Response(JSON.stringify({ redirect_url: 'https://crypto.link.com.evil.test/phish' }), { status: 200 }),
  });
  assert.equal(phish.ok, false);

  let bypassHeader: string | null = 'missing';
  await postOnrampSession({
    endpoint: 'https://preview.example/api/onramp-session',
    body: built.body,
    appToken: null,
    vercelBypass: '  preview-bypass  ',
    fetchImpl: async (_url, init) => {
      bypassHeader = new Headers(init?.headers).get('x-vercel-protection-bypass');
      return new Response(JSON.stringify({ redirect_url: 'https://crypto.link.com?session_hash=unit' }), { status: 200 });
    },
  });
  assert.equal(bypassHeader, 'preview-bypass');

  const insecure = await postOnrampSession({
    endpoint: 'http://10.1.2.3/api/onramp-session',
    body: built.body,
    appToken: null,
    fetchImpl: async () => {
      throw new Error('should not fetch');
    },
  });
  assert.equal(insecure.ok, false);
});

test('only https://crypto.link.com is an onramp link', () => {
  assert.equal(isStripeHostedOnrampUrl('https://crypto.link.com?session_hash=abc'), true);
  assert.equal(isStripeHostedOnrampUrl('https://crypto.link.com/session'), true);
  assert.equal(isStripeHostedOnrampUrl('http://crypto.link.com'), false);
  assert.equal(isStripeHostedOnrampUrl('https://crypto.link.com.evil.test'), false);
  assert.equal(isStripeHostedOnrampUrl('https://evil.test/?next=https://crypto.link.com'), false);
  assert.equal(isStripeHostedOnrampUrl('https://user:pass@crypto.link.com'), false);
  assert.equal(readOnrampRedirect({ redirect_url: 'https://crypto.link.com?session_hash=abc', client_secret: 'x' }).ok, true);
  assert.equal(readOnrampRedirect({ redirect_url: 'https://wallet-phishing.test' }).ok, false);
});

test('the Buy screen never reads a seed or private key', () => {
  const screen = readFileSync(new URL('../../screens/BuyScreen.tsx', import.meta.url), 'utf8');
  const opener = readFileSync(new URL('./open.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(screen, /mnemonic|privateKey|seed|STRIPE_SECRET|sk_live|sk_test_/i);
  assert.match(screen, /session\?\.address/);
  assert.match(screen, /solanaAddress/);
  assert.match(screen, /Powered by Stripe/);
  assert.match(screen, /does not charge a fee/);
  assert.match(opener, /openBrowserAsync/);
  assert.doesNotMatch(opener, /webview/i);
  assert.doesNotMatch(screen, /webview/i);
});
