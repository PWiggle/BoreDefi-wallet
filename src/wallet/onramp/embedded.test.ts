import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  embeddedOnrampEndpoint,
  embeddedOnrampPlatform,
  embeddedPurchaseApi,
  isEmbeddedOnrampOffer,
  readEmbeddedClientSecret,
  runEmbeddedPurchase,
  testPublishableKey,
  validateEmbeddedForm,
  type EmbeddedIdentity,
  type EmbeddedPurchaseSdk,
} from './embedded';

const EVM = '0x9858effd232b4033e47d90003d41ec34ecaeda94';

function identity(overrides: Partial<EmbeddedIdentity> = {}): EmbeddedIdentity {
  return {
    email: 'buyer@example.com',
    phone: '+12125551234',
    fullName: 'John Verified',
    firstName: 'John',
    lastName: 'Verified',
    idNumber: '000000000',
    dateOfBirth: { day: 1, month: 1, year: 1990 },
    address: { line1: 'address_full_match', city: 'Seattle', state: 'WA', postalCode: '98101', country: 'US' },
    sourceAmount: '50.00',
    ...overrides,
  };
}

function sdk(overrides: Partial<EmbeddedPurchaseSdk> = {}): EmbeddedPurchaseSdk {
  return {
    async configure() {
      return {};
    },
    async hasLinkAccount() {
      return { hasLinkAccount: true };
    },
    async registerLinkUser() {
      return {};
    },
    async authorize() {
      return { customerId: 'cus_testcustomer' };
    },
    async presentTermsOfService() {
      return {};
    },
    async attachKyc() {
      return {};
    },
    async presentKycVerification() {
      return {};
    },
    async fulfillKyc() {
      return {};
    },
    async registerWallet() {
      return {};
    },
    async collectCard() {
      return {};
    },
    async createPaymentToken() {
      return { token: 'cpt_testtoken' };
    },
    async presentPurchaseTerms() {
      return {};
    },
    async verifyIdentity() {
      return {};
    },
    async performCheckout(_sessionId, provide) {
      const secret = await provide();
      if (!secret) {
        return { error: 'missing secret' };
      }
      return {};
    },
    ...overrides,
  };
}

test('only a test publishable key enables in-app checkout, and only on iOS and Android', () => {
  assert.equal(testPublishableKey(undefined), null);
  assert.equal(testPublishableKey('pk_live_abcdefghij'), null);
  assert.equal(testPublishableKey('pk_test_short'), null);
  assert.equal(testPublishableKey('pk_test_live_hidden'), null);
  assert.equal(testPublishableKey('  pk_test_unit_test_key  '), 'pk_test_unit_test_key');
  assert.equal(embeddedOnrampPlatform('ios'), true);
  assert.equal(embeddedOnrampPlatform('android'), true);
  assert.equal(embeddedOnrampPlatform('web'), false);
  assert.equal(isEmbeddedOnrampOffer('eth-base'), true);
  assert.equal(isEmbeddedOnrampOffer('usdc-solana'), true);
  assert.equal(isEmbeddedOnrampOffer('sol-solana'), true);
  assert.equal(isEmbeddedOnrampOffer('usdc-polygon'), false);
  assert.equal(isEmbeddedOnrampOffer('matic-polygon'), false);
  assert.equal(embeddedOnrampEndpoint('https://preview.example/api/onramp-session'), 'https://preview.example/api/onramp-embedded');
  assert.equal(embeddedOnrampEndpoint('http://10.1.2.3/api/onramp-session'), null);
});

test('the in-app form rejects New York, a missing agreement, and a bad amount', () => {
  const good = validateEmbeddedForm({
    email: 'buyer@example.com',
    phone: '+12125551234',
    fullName: 'John Verified',
    day: '1',
    month: '1',
    year: '1990',
    idNumber: '000000000',
    line1: 'address_full_match',
    city: 'Seattle',
    state: 'wa',
    postalCode: '98101',
    sourceAmount: '50',
    acceptedTerms: true,
  });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.address.state, 'WA');
    assert.equal(good.value.sourceAmount, '50.00');
    assert.equal(good.value.idNumber, '000000000');
  }
  assert.equal(validateEmbeddedForm({
    email: 'buyer@example.com',
    phone: '+12125551234',
    fullName: 'John Verified',
    day: '1',
    month: '1',
    year: '1990',
    idNumber: '000000000',
    line1: '1 Main',
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    sourceAmount: '50',
    acceptedTerms: true,
  }).ok, false);
  const unpaid = validateEmbeddedForm({
    email: 'buyer@example.com',
    phone: '+12125551234',
    fullName: 'John Verified',
    day: '1',
    month: '1',
    year: '1990',
    idNumber: '000000000',
    line1: '1 Main',
    city: 'Seattle',
    state: 'WA',
    postalCode: '98101',
    sourceAmount: '0',
    acceptedTerms: true,
  });
  assert.equal(unpaid.ok, false);
});

test('a purchase posts the public address and amount, and the checkout secret is only returned to the SDK', async () => {
  const bodies: unknown[] = [];
  const api = embeddedPurchaseApi({
    endpoint: 'https://preview.example/api/onramp-embedded',
    appToken: null,
    vercelBypass: null,
    walletAddress: EVM,
    sourceAmount: '50.00',
  });
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
    bodies.push(body);
    if (body.action === 'link_auth') {
      return new Response(JSON.stringify({ auth_intent_id: 'lai_testintent', access_token: 'liwltoken_should_not_surface' }), { status: 200 });
    }
    if (body.action === 'session') {
      return new Response(JSON.stringify({ session_id: 'cos_testsession', client_secret: 'cos_testsession_secret_ignored' }), { status: 200 });
    }
    return new Response(JSON.stringify({ client_secret: 'cos_testsession_secret_unitvalue' }), { status: 200 });
  }) as typeof fetch;
  try {
    let secretSeen = '';
    const result = await runEmbeddedPurchase({
      sdk: sdk({
        async performCheckout(_sessionId, provide) {
          secretSeen = (await provide()) ?? '';
          return {};
        },
      }),
      api,
      identity: identity(),
      currency: 'eth',
      network: 'ethereum',
      walletAddress: EVM,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(secretSeen, 'cos_testsession_secret_unitvalue');
    assert.equal(bodies.length, 3);
    const session = bodies[1] as Record<string, string>;
    assert.equal(session.destination_currency, 'eth');
    assert.equal(session.destination_network, 'ethereum');
    assert.equal(session.wallet_address, EVM);
    assert.equal(session.source_amount, '50.00');
    assert.equal(session.id_number, undefined);
    assert.doesNotMatch(JSON.stringify(session), /000000000|mnemonic|private/i);
  } finally {
    globalThis.fetch = original;
  }

  const denied = await readEmbeddedClientSecret({ client_secret: 'not-a-secret', access_token: 'liwltoken_nope' });
  assert.equal(denied.ok, false);
});

test('an identity challenge retries checkout once, and a cancel stops', async () => {
  let sessions = 0;
  const retried = await runEmbeddedPurchase({
    sdk: sdk({
      async verifyIdentity() {
        return {};
      },
    }),
    api: {
      async linkAuth() {
        return { ok: true, authIntentId: 'lai_testintent' };
      },
      async session() {
        sessions += 1;
        if (sessions === 1) {
          return { ok: false, error: 'Identity verification is required before this purchase.', identityRequired: true };
        }
        return { ok: true, sessionId: 'cos_testsession' };
      },
      async checkout() {
        return { ok: true, clientSecret: 'cos_testsession_secret_unitvalue' };
      },
    },
    identity: identity(),
    currency: 'usdc',
    network: 'base',
    walletAddress: EVM,
  });
  assert.deepEqual(retried, { ok: true });
  assert.equal(sessions, 2);

  const canceled = await runEmbeddedPurchase({
    sdk: sdk({
      async authorize() {
        return { canceled: true };
      },
    }),
    api: {
      async linkAuth() {
        return { ok: true, authIntentId: 'lai_testintent' };
      },
      async session() {
        throw new Error('session should not run');
      },
      async checkout() {
        throw new Error('checkout should not run');
      },
    },
    identity: identity(),
    currency: 'sol',
    network: 'solana',
    walletAddress: EVM,
  });
  assert.deepEqual(canceled, { ok: false, error: 'Checkout canceled.' });
});

test('the in-app Buy path never reads a recovery phrase or a Stripe secret', () => {
  const buy = readFileSync(new URL('../../screens/BuyScreen.tsx', import.meta.url), 'utf8');
  const native = readFileSync(new URL('../../screens/EmbeddedOnramp.native.tsx', import.meta.url), 'utf8');
  const flow = readFileSync(new URL('./embedded.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(buy, /mnemonic|privateKey|seed|STRIPE_SECRET|sk_live|sk_test_/i);
  assert.doesNotMatch(native, /STRIPE_SECRET|sk_live_|sk_test_[A-Za-z0-9]/i);
  assert.doesNotMatch(flow, /STRIPE_SECRET|sk_live_|sk_test_[A-Za-z0-9]/i);
  assert.match(buy, /Continue with Transak/);
  assert.match(buy, /Continue in browser/);
  assert.match(native, /does not charge a fee/);
  assert.match(native, /does not cover Stripe/);
  assert.match(readFileSync(new URL('../../../app.json', import.meta.url), 'utf8'), /includeOnramp/);
  assert.match(readFileSync(new URL('../../../eas.json', import.meta.url), 'utf8'), /onramp-preview/);
});
