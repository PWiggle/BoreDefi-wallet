import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { handleEmbeddedOnrampRequest } from './embedded-handler';
import {
  EMBEDDED_NETWORKS,
  STRIPE_EMBEDDED_ONRAMP_VERSION,
  checkoutEmbeddedOnrampSession,
  createEmbeddedOnrampSession,
  createLinkAuthIntent,
  embeddedSessionForm,
} from './embedded';
import { createRateLimiter, envFromProcess, type OnrampServerEnv } from './handler';
import { STRIPE_ONRAMP_API, STRIPE_ONRAMP_VERSION } from './stripe';

const EVM = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const TEST_KEY = 'sk_test_unit_test_key';
const OAUTH = 'oauth_client_unit';
const TOKEN = 'liwltoken_unit_test_value';
const SESSION = 'cos_testsession';
const SECRET = 'cos_testsession_secret_unitvalue';

function env(overrides: Partial<OnrampServerEnv> = {}): OnrampServerEnv {
  return {
    mode: 'test',
    stripeSecretKey: TEST_KEY,
    allowedOrigins: undefined,
    appToken: undefined,
    linkOauthClientId: OAUTH,
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://onramp.example/api/onramp-embedded', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('embedded sessions lock the wallet, add no fee, and use the beta header only there', () => {
  assert.equal(STRIPE_EMBEDDED_ONRAMP_VERSION, `${STRIPE_ONRAMP_VERSION};crypto_onramp_beta=v2`);
  assert.deepEqual(EMBEDDED_NETWORKS, ['ethereum', 'base', 'solana']);
  const form = embeddedSessionForm({
    cryptoCustomerId: 'cus_testcustomer',
    cryptoPaymentToken: 'cpt_testtoken',
    currency: 'usdc',
    network: 'base',
    walletAddress: EVM,
    sourceAmount: '50.00',
    customerIp: '203.0.113.10',
  });
  assert.equal(form.get('ui_mode'), 'headless');
  assert.equal(form.get('source_currency'), 'usd');
  assert.equal(form.get('source_amount'), '50.00');
  assert.equal(form.get('destination_currency'), 'usdc');
  assert.equal(form.get('destination_network'), 'base');
  assert.equal(form.get('wallet_addresses[base_network]'), EVM);
  assert.equal(form.get('wallet_addresses[base]'), null);
  assert.equal(form.get('lock_wallet_address'), 'true');
  assert.equal(form.get('customer_ip_address'), '203.0.113.10');
  const encoded = form.toString();
  assert.doesNotMatch(encoded, /application_fee|fee_subsid|subsid|sk_test|sk_live|liwltoken/i);
});

test('a test key in STRIPE_SECRET_KEY is used only when the test var is unset, and a live key is ignored', () => {
  assert.equal(envFromProcess({ STRIPE_SECRET_KEY: TEST_KEY }).stripeSecretKey, TEST_KEY);
  assert.equal(
    envFromProcess({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_SECRET_KEY_TEST: 'sk_test_preferred_key' }).stripeSecretKey,
    'sk_test_preferred_key',
  );
  assert.equal(envFromProcess({ STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop' }).stripeSecretKey, undefined);
  assert.equal(envFromProcess({ STRIPE_LINK_OAUTH_CLIENT_ID: '  link-client  ' }).linkOauthClientId, 'link-client');
});

test('link auth, session, and checkout stay in test mode and never return the OAuth token', async () => {
  const calls: { url: string; version: string; oauth: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      version: headers.get('stripe-version') ?? '',
      oauth: headers.get('stripe-oauth-token') ?? '',
      body: String(init?.body ?? ''),
    });
    const target = String(url);
    if (target.endsWith('/tokens')) {
      return new Response(JSON.stringify({ access_token: TOKEN, token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
    }
    if (target.endsWith('/checkout')) {
      return new Response(JSON.stringify({ id: SESSION, livemode: false, client_secret: SECRET, access_token: TOKEN }), { status: 200 });
    }
    if (target === 'https://login.link.com/v1/link_auth_intent') {
      return new Response(JSON.stringify({ id: 'lai_testintent', expires_at: 1 }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ id: SESSION, livemode: false, client_secret: SECRET, redirect_url: 'https://crypto.link.com?session_hash=unit' }),
      { status: 200 },
    );
  };

  const link = await handleEmbeddedOnrampRequest(post({ action: 'link_auth', email: 'buyer@example.com' }), env(), {
    now: () => 1,
    rateLimit: createRateLimiter(),
    fetchImpl,
  });
  assert.equal(link.status, 200);
  assert.deepEqual(await link.json(), { auth_intent_id: 'lai_testintent' });
  assert.equal(calls[0]?.version, '');
  assert.doesNotMatch(calls[0]?.body ?? '', /sk_test|fee/i);

  calls.length = 0;
  const session = await handleEmbeddedOnrampRequest(
    post({
      action: 'session',
      auth_intent_id: 'lai_testintent',
      crypto_customer_id: 'cus_testcustomer',
      crypto_payment_token: 'cpt_testtoken',
      destination_currency: 'eth',
      destination_network: 'ethereum',
      wallet_address: EVM,
      source_amount: '25',
    }),
    env(),
    { now: () => 2, rateLimit: createRateLimiter(), fetchImpl },
  );
  assert.equal(session.status, 200);
  const sessionBody = (await session.json()) as Record<string, string>;
  assert.deepEqual(sessionBody, { session_id: SESSION });
  assert.equal('client_secret' in sessionBody, false);
  assert.equal(calls[0]?.url, 'https://login.link.com/v1/link_auth_intent/lai_testintent/tokens');
  assert.equal(calls[1]?.url, STRIPE_ONRAMP_API);
  assert.equal(calls[1]?.version, STRIPE_EMBEDDED_ONRAMP_VERSION);
  assert.equal(calls[1]?.oauth, TOKEN);
  assert.match(calls[1]?.body ?? '', /wallet_addresses(?:%5B|\[)ethereum(?:%5D|\])/);
  assert.doesNotMatch(JSON.stringify(sessionBody), new RegExp(TOKEN));

  calls.length = 0;
  const checkout = await handleEmbeddedOnrampRequest(
    post({ action: 'checkout', auth_intent_id: 'lai_testintent', session_id: SESSION }),
    env(),
    { now: () => 3, rateLimit: createRateLimiter(), fetchImpl },
  );
  assert.equal(checkout.status, 200);
  const checkoutBody = (await checkout.json()) as Record<string, string>;
  assert.deepEqual(checkoutBody, { client_secret: SECRET });
  assert.equal('access_token' in checkoutBody, false);
  assert.equal(calls.at(-1)?.url, `${STRIPE_ONRAMP_API}/${SESSION}/checkout`);
  assert.doesNotMatch(calls.at(-1)?.body ?? '', /fee|source_amount/i);
});

test('polygon, a seed field, a live key, and a live session never start an embedded purchase', async () => {
  let fetched = false;
  const fetchImpl: typeof fetch = async () => {
    fetched = true;
    throw new Error('fetch should not run');
  };
  const deps = { now: () => 4, rateLimit: createRateLimiter(), fetchImpl };
  const polygon = await handleEmbeddedOnrampRequest(
    post({
      action: 'session',
      auth_intent_id: 'lai_testintent',
      crypto_customer_id: 'cus_testcustomer',
      crypto_payment_token: 'cpt_testtoken',
      destination_currency: 'usdc',
      destination_network: 'polygon',
      wallet_address: EVM,
      source_amount: '10',
    }),
    env(),
    deps,
  );
  assert.equal(polygon.status, 400);
  assert.match((await polygon.json() as { error: string }).error, /browser/);

  const extra = await handleEmbeddedOnrampRequest(
    post({
      action: 'link_auth',
      email: 'buyer@example.com',
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      id_number: '000000000',
    }),
    env(),
    deps,
  );
  assert.equal(extra.status, 400);

  const live = await handleEmbeddedOnrampRequest(
    post({ action: 'link_auth', email: 'buyer@example.com' }),
    env({ mode: 'live', stripeSecretKey: 'sk_live_abcdefghijklmnop' }),
    deps,
  );
  assert.equal(live.status, 403);
  assert.equal(fetched, false);

  await assert.rejects(
    createEmbeddedOnrampSession({
      secretKey: 'sk_live_abcdefghijklmnop',
      authIntentId: 'lai_testintent',
      cryptoCustomerId: 'cus_testcustomer',
      cryptoPaymentToken: 'cpt_testtoken',
      currency: 'sol',
      network: 'solana',
      walletAddress: SOL,
      sourceAmount: '10.00',
      customerIp: null,
      fetchImpl,
    }),
    /test mode only/,
  );
  await assert.rejects(
    checkoutEmbeddedOnrampSession({
      secretKey: TEST_KEY,
      mode: 'live',
      authIntentId: 'lai_testintent',
      sessionId: SESSION,
      fetchImpl,
    }),
    /test mode only/,
  );
  await assert.rejects(
    createLinkAuthIntent({ secretKey: TEST_KEY, email: 'buyer@example.com', oauthClientId: '   ', fetchImpl }),
    /not configured/,
  );
  assert.equal(fetched, false);
});

test('identity challenges are a stable 409 and Stripe secrets are scrubbed', async () => {
  const response = await handleEmbeddedOnrampRequest(
    post({
      action: 'session',
      auth_intent_id: 'lai_testintent',
      crypto_customer_id: 'cus_testcustomer',
      crypto_payment_token: 'cpt_testtoken',
      destination_currency: 'sol',
      destination_network: 'solana',
      wallet_address: SOL,
      source_amount: '10',
    }),
    env(),
    {
      now: () => 5,
      rateLimit: createRateLimiter(),
      fetchImpl: async (url) => {
        if (String(url).endsWith('/tokens')) {
          return new Response(JSON.stringify({ access_token: TOKEN }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ error: { code: 'crypto_onramp_missing_document_verification', message: `need docs ${TEST_KEY} ${TOKEN}` } }),
          { status: 400 },
        );
      },
    },
  );
  assert.equal(response.status, 409);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, 'Identity verification is required before this purchase.');
  assert.doesNotMatch(body.error, /sk_test|liwltoken/);
});

test('the embedded entrypoint does not embed a key, a fee address, or a log of the request', () => {
  const files = [
    '../../api/onramp-embedded.ts',
    './embedded.ts',
    './embedded-handler.ts',
  ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));
  const src = files.join('\n');
  assert.doesNotMatch(src, /sk_(live|test)_[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(src, /pk_(live|test)_[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(src, /console\.(log|info|debug|warn|error)/);
  assert.match(src, /lock_wallet_address/);
  assert.doesNotMatch(src, /application_fee|fee_subsid/);
});
