import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertTestSecretKey,
  createStripeOnrampSession,
  OnrampRefused,
  redactSecrets,
  STRIPE_ONRAMP_API,
  STRIPE_ONRAMP_VERSION,
  stripeOnrampForm,
  walletAddressKey,
} from './stripe';

const EVM = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
const TEST_KEY = 'sk_test_unit_test_key';

test('refuses a missing key, a live key, and anything that is not sk_test_', () => {
  assert.throws(() => assertTestSecretKey(undefined), /not set/);
  assert.throws(() => assertTestSecretKey('   '), /not set/);
  assert.throws(() => assertTestSecretKey('sk_live_abcdefghij'), /test mode only/);
  assert.throws(() => assertTestSecretKey('  sk_live_abcdefghij'), /test mode only/);
  assert.throws(() => assertTestSecretKey('rk_live_abcdefghij'), /test mode only/);
  assert.throws(() => assertTestSecretKey('SK_LIVE_abcdefghij'), /test mode only/);
  assert.throws(() => assertTestSecretKey('sk_test_sk_live_hidden'), /test mode only/);
  assert.throws(() => assertTestSecretKey('pk_test_abcdefghij'), /sk_test_/);
  assert.throws(() => assertTestSecretKey('sk_test_short'), /sk_test_/);
  assert.equal(assertTestSecretKey(`  ${TEST_KEY}  `), TEST_KEY);
});

test('wallet address keys follow the session object, not the destination_network enum', () => {
  assert.equal(STRIPE_ONRAMP_VERSION, '2026-10-28.endive');
  assert.doesNotMatch(STRIPE_ONRAMP_VERSION, /crypto_onramp_beta/);
  assert.equal(walletAddressKey('ethereum'), 'ethereum');
  assert.equal(walletAddressKey('base'), 'base_network');
  assert.equal(walletAddressKey('polygon'), 'polygon');
  assert.equal(walletAddressKey('solana'), 'solana');
  assert.throws(() => walletAddressKey('avalanche'), /no Stripe wallet address field/);
  assert.throws(() => walletAddressKey('base_network'), /no Stripe wallet address field/);
});

test('the Stripe form locks the asset, network, and wallet and does not add a fee or the secret', () => {
  const form = stripeOnrampForm({
    secretKey: TEST_KEY,
    currency: 'eth',
    network: 'ethereum',
    walletAddress: EVM,
    customerIp: '203.0.113.10',
  });
  assert.equal(form.get('destination_currency'), 'eth');
  assert.equal(form.get('destination_network'), 'ethereum');
  assert.deepEqual(form.getAll('destination_currencies[]'), ['eth']);
  assert.deepEqual(form.getAll('destination_networks[]'), ['ethereum']);
  assert.equal(form.get('wallet_addresses[ethereum]'), EVM);
  const base = stripeOnrampForm({
    secretKey: TEST_KEY,
    currency: 'usdc',
    network: 'base',
    walletAddress: EVM,
    customerIp: null,
  });
  assert.equal(base.get('destination_network'), 'base');
  assert.equal(base.get('wallet_addresses[base_network]'), EVM);
  assert.equal(base.get('wallet_addresses[base]'), null);
  const polygon = stripeOnrampForm({
    secretKey: TEST_KEY,
    currency: 'usdc',
    network: 'polygon',
    walletAddress: EVM,
    customerIp: null,
  });
  assert.equal(polygon.get('wallet_addresses[polygon]'), EVM);
  assert.equal(form.get('lock_wallet_address'), 'true');
  assert.equal(form.get('customer_ip_address'), '203.0.113.10');
  assert.equal(form.get('metadata[source]'), 'boredefi-wallet');
  const encoded = form.toString();
  assert.doesNotMatch(encoded, /sk_test|sk_live|application_fee|fee/i);
});

test('a test-mode session returns only the hosted redirect, and a live session is refused', async () => {
  const calls: { url: string; authorization: string; version: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      authorization: headers.get('authorization') ?? '',
      version: headers.get('stripe-version') ?? '',
      body: String(init?.body ?? ''),
    });
    return new Response(
      JSON.stringify({
        id: 'cos_test',
        livemode: false,
        redirect_url: 'https://crypto.link.com?session_hash=unit',
        client_secret: 'cos_test_secret_should_not_leak',
      }),
      { status: 200 },
    );
  };
  const session = await createStripeOnrampSession(
    { secretKey: TEST_KEY, currency: 'usdc', network: 'base', walletAddress: EVM, customerIp: null },
    fetchImpl,
  );
  assert.deepEqual(session, { redirectUrl: 'https://crypto.link.com?session_hash=unit' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, STRIPE_ONRAMP_API);
  assert.equal(calls[0]?.version, STRIPE_ONRAMP_VERSION);
  assert.equal(Buffer.from((calls[0]?.authorization ?? '').replace('Basic ', ''), 'base64').toString('utf8'), `${TEST_KEY}:`);
  assert.match(calls[0]?.body ?? '', /wallet_addresses%5Bbase_network%5D|wallet_addresses\[base_network\]/);
  assert.doesNotMatch(calls[0]?.body ?? '', /wallet_addresses(?:%5B|\[)base(?:%5D|\])/);
  assert.doesNotMatch(JSON.stringify(session), /client_secret|sk_test/);

  const live = createStripeOnrampSession(
    { secretKey: TEST_KEY, currency: 'eth', network: 'ethereum', walletAddress: EVM, customerIp: null },
    async () => new Response(JSON.stringify({ livemode: true, redirect_url: 'https://crypto.link.com?session_hash=live' }), { status: 200 }),
  );
  await assert.rejects(live, (error: unknown) => {
    assert.ok(error instanceof OnrampRefused);
    assert.equal(error.status, 502);
    assert.match(error.message, /live-mode/);
    return true;
  });
});

test('a live key never reaches fetch, and Stripe errors are scrubbed', async () => {
  await assert.rejects(
    createStripeOnrampSession(
      { secretKey: 'sk_live_abcdefghijklmnop', currency: 'eth', network: 'ethereum', walletAddress: EVM, customerIp: null },
      async () => {
        throw new Error('fetch should not run');
      },
    ),
    /test mode only/,
  );

  await assert.rejects(
    createStripeOnrampSession(
      { secretKey: TEST_KEY, currency: 'eth', network: 'ethereum', walletAddress: EVM, customerIp: null },
      async () =>
        new Response(JSON.stringify({ error: { message: `bad ${TEST_KEY}` } }), { status: 400, headers: { 'content-type': 'application/json' } }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof OnrampRefused);
      assert.doesNotMatch(error.message, /sk_test/);
      assert.match(error.message, /\[redacted\]/);
      return true;
    },
  );

  await assert.rejects(
    createStripeOnrampSession(
      { secretKey: TEST_KEY, currency: 'eth', network: 'ethereum', walletAddress: EVM, customerIp: null },
      async () => new Response(JSON.stringify({ livemode: false, redirect_url: 'https://evil.example/phish' }), { status: 200 }),
    ),
    /hosted onramp link/,
  );
});

test('redactSecrets strips test and live keys', () => {
  assert.equal(redactSecrets(`see ${TEST_KEY} and rk_live_abcdefghij`), 'see [redacted] and [redacted]');
});
