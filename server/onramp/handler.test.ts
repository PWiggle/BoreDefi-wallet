import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createStripeOnrampSession } from './stripe';
import { clientIp, createRateLimiter, envFromProcess, handleOnrampRequest, type OnrampDeps, type OnrampServerEnv } from './handler';

const EVM = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const REDIRECT = 'https://crypto.link.com?session_hash=unit';
const TEST_KEY = 'sk_test_unit_test_key';

function env(overrides: Partial<OnrampServerEnv> = {}): OnrampServerEnv {
  return {
    mode: 'test',
    stripeSecretKey: TEST_KEY,
    allowedOrigins: undefined,
    appToken: undefined,
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://onramp.example/api/onramp-session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function okDeps(
  onCall?: (input: { secretKey: string; mode?: 'test' | 'live'; currency: string; network: string; walletAddress: string }) => void,
): OnrampDeps {
  return {
    now: () => 1_700_000_000_000,
    rateLimit: createRateLimiter(10, 60_000),
    stripe: async (input) => {
      onCall?.(input);
      return { redirectUrl: REDIRECT };
    },
  };
}

test('envFromProcess reads only the key for the selected mode', () => {
  const read = envFromProcess({
    STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop',
    STRIPE_SECRET_KEY_TEST: TEST_KEY,
    STRIPE_SECRET_KEY_LIVE: 'sk_live_abcdefghijklmnop',
    ONRAMP_ALLOWED_ORIGINS: 'https://app.example',
    ONRAMP_APP_TOKEN: 'app-token',
  });
  assert.equal(read.mode, 'test');
  assert.equal(read.stripeSecretKey, TEST_KEY);
  assert.equal(read.allowedOrigins, 'https://app.example');
  assert.equal(read.appToken, 'app-token');
  assert.equal(envFromProcess({ STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop' }).stripeSecretKey, undefined);
  const live = envFromProcess({
    ONRAMP_MODE: 'live',
    STRIPE_SECRET_KEY_TEST: TEST_KEY,
    STRIPE_SECRET_KEY_LIVE: 'sk_live_abcdefghijklmnop',
  });
  assert.equal(live.mode, 'live');
  assert.equal(live.stripeSecretKey, 'sk_live_abcdefghijklmnop');
  assert.equal(envFromProcess({ ONRAMP_MODE: 'live', STRIPE_SECRET_KEY_TEST: TEST_KEY }).stripeSecretKey, undefined);
  assert.equal(envFromProcess({ ONRAMP_MODE: 'production' }).mode, 'test');
});

test('a valid Ethereum USDC purchase returns the hosted redirect and nothing else', async () => {
  let seen = '';
  const response = await handleOnrampRequest(
    post({ destination_currency: 'usdc', destination_network: 'ethereum', wallet_address: EVM }),
    env(),
    okDeps((input) => {
      seen = `${input.currency}:${input.network}:${input.walletAddress}:${input.secretKey}`;
    }),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { redirect_url?: string; client_secret?: string };
  assert.deepEqual(body, { redirect_url: REDIRECT });
  assert.equal(seen, `usdc:ethereum:${EVM}:${TEST_KEY}`);
  assert.equal(clientIp(post({}, { 'x-forwarded-for': '198.51.100.14, 10.0.0.1' })), '198.51.100.14');
});

test('a Solana address is accepted only for Solana', async () => {
  const good = await handleOnrampRequest(
    post({ destination_currency: 'sol', destination_network: 'solana', wallet_address: SOL }),
    env(),
    okDeps(),
  );
  assert.equal(good.status, 200);

  const wrong = await handleOnrampRequest(
    post({ destination_currency: 'eth', destination_network: 'ethereum', wallet_address: SOL }),
    env(),
    okDeps(() => {
      throw new Error('stripe should not be called');
    }),
  );
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json() as { error: string }).error, /Ethereum-style/);

  const flipped = await handleOnrampRequest(
    post({ destination_currency: 'sol', destination_network: 'solana', wallet_address: EVM }),
    env(),
    okDeps(() => {
      throw new Error('stripe should not be called');
    }),
  );
  assert.equal(flipped.status, 400);
  assert.match((await flipped.json() as { error: string }).error, /Solana/);
});

test('rejects unsupported pairs, the zero address, and extra fields such as a seed', async () => {
  for (const body of [
    { destination_currency: 'btc', destination_network: 'bitcoin', wallet_address: EVM },
    { destination_currency: 'eth', destination_network: 'solana', wallet_address: SOL },
    { destination_currency: 'usdc', destination_network: 'optimism', wallet_address: EVM },
    { destination_currency: 'eth', destination_network: 'ethereum', wallet_address: '0x0000000000000000000000000000000000000000' },
    { destination_currency: 'eth', destination_network: 'ethereum', wallet_address: '  ' },
  ]) {
    const response = await handleOnrampRequest(post(body), env(), okDeps(() => {
      throw new Error('stripe should not be called');
    }));
    assert.equal(response.status, 400, JSON.stringify(body));
  }

  const extra = await handleOnrampRequest(
    post({
      destination_currency: 'eth',
      destination_network: 'ethereum',
      wallet_address: EVM,
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    }),
    env(),
    okDeps(() => {
      throw new Error('stripe should not be called');
    }),
  );
  assert.equal(extra.status, 400);
  assert.match((await extra.json() as { error: string }).error, /Unexpected field/);
});

test('refuses a live key and a live-mode Stripe session without returning a link', async () => {
  const liveKey = await handleOnrampRequest(
    post({ destination_currency: 'eth', destination_network: 'base', wallet_address: EVM }),
    env({ stripeSecretKey: 'sk_live_abcdefghijklmnop' }),
    {
      now: () => 10,
      rateLimit: createRateLimiter(),
      stripe: (input) =>
        createStripeOnrampSession(input, async () => {
          throw new Error('fetch should not run');
        }),
    },
  );
  assert.equal(liveKey.status, 403);
  const liveKeyBody = (await liveKey.json()) as { error: string; redirect_url?: string };
  assert.match(liveKeyBody.error, /test mode only/);
  assert.equal(liveKeyBody.redirect_url, undefined);

  const liveSession = await handleOnrampRequest(
    post({ destination_currency: 'eth', destination_network: 'base', wallet_address: EVM }),
    env(),
    {
      now: () => 11,
      rateLimit: createRateLimiter(),
      stripe: (input) =>
        createStripeOnrampSession(
          input,
          async () =>
            new Response(
              JSON.stringify({
                livemode: true,
                redirect_url: REDIRECT,
                client_secret: 'cos_secret',
              }),
              { status: 200 },
            ),
        ),
    },
  );
  assert.equal(liveSession.status, 502);
  const text = await liveSession.text();
  assert.match(text, /live-mode/);
  assert.doesNotMatch(text, /redirect_url|client_secret|sk_test/);
});

test('refuses a Stripe redirect that is not crypto.link.com', async () => {
  const response = await handleOnrampRequest(post({ destination_currency: 'eth', destination_network: 'ethereum', wallet_address: EVM }), env(), {
    now: () => 12,
    rateLimit: createRateLimiter(),
    stripe: (input) =>
      createStripeOnrampSession(
        input,
        async () => new Response(JSON.stringify({ livemode: false, redirect_url: 'https://crypto.link.com.evil.test/phish' }), { status: 200 }),
      ),
  });
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /evil\.test/);
});

test('origin allowlist permits native and localhost calls and blocks other sites', async () => {
  const blockedByDefault = await handleOnrampRequest(
    post({ destination_currency: 'eth', destination_network: 'ethereum', wallet_address: EVM }, { origin: 'https://evil.example' }),
    env(),
    okDeps(() => {
      throw new Error('stripe should not be called');
    }),
  );
  assert.equal(blockedByDefault.status, 403);

  const blocked = await handleOnrampRequest(
    post({ destination_currency: 'eth', destination_network: 'ethereum', wallet_address: EVM }, { origin: 'https://evil.example' }),
    env({ allowedOrigins: 'https://app.example' }),
    okDeps(() => {
      throw new Error('stripe should not be called');
    }),
  );
  assert.equal(blocked.status, 403);

  const allowed = await handleOnrampRequest(
    post({ destination_currency: 'eth', destination_network: 'ethereum', wallet_address: EVM }, { origin: 'https://app.example' }),
    env({ allowedOrigins: 'https://app.example' }),
    okDeps(),
  );
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example');

  const native = await handleOnrampRequest(
    post({ destination_currency: 'eth', destination_network: 'ethereum', wallet_address: EVM }),
    env({ allowedOrigins: 'https://app.example' }),
    okDeps(),
  );
  assert.equal(native.status, 200);

  const local = await handleOnrampRequest(
    post(
      { destination_currency: 'eth', destination_network: 'ethereum', wallet_address: EVM },
      { origin: 'http://localhost:8081' },
    ),
    env({ allowedOrigins: 'https://app.example' }),
    okDeps(),
  );
  assert.equal(local.status, 200);
});

test('rate limit and optional app token', async () => {
  const limiter = createRateLimiter(2, 60_000);
  const deps: OnrampDeps = { now: () => 50, rateLimit: limiter, stripe: async () => ({ redirectUrl: REDIRECT }) };
  const body = { destination_currency: 'eth', destination_network: 'ethereum', wallet_address: EVM };
  assert.equal((await handleOnrampRequest(post(body), env(), deps)).status, 200);
  assert.equal((await handleOnrampRequest(post(body), env(), deps)).status, 200);
  const limited = await handleOnrampRequest(post(body), env(), deps);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');

  const tokenEnv = env({ appToken: 'desktop-token' });
  const fresh: OnrampDeps = { now: () => 80, rateLimit: createRateLimiter(), stripe: async () => ({ redirectUrl: REDIRECT }) };
  assert.equal((await handleOnrampRequest(post(body), tokenEnv, fresh)).status, 401);
  assert.equal(
    (await handleOnrampRequest(post(body, { 'x-boredefi-onramp': 'nope' }), tokenEnv, fresh)).status,
    401,
  );
  assert.equal(
    (await handleOnrampRequest(post(body, { 'x-boredefi-onramp': 'desktop-token' }), tokenEnv, fresh)).status,
    200,
  );
});

test('live mode accepts a mobile request with no Origin and refuses a test key', async () => {
  const LIVE_KEY = 'sk_live_unit_test_key';
  let seenMode = '';
  const response = await handleOnrampRequest(
    post({ destination_currency: 'eth', destination_network: 'ethereum', wallet_address: EVM }),
    env({ mode: 'live', stripeSecretKey: LIVE_KEY }),
    okDeps((input) => {
      seenMode = `${input.mode ?? ''}:${input.secretKey.startsWith('sk_live_')}`;
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(seenMode, 'live:true');
  assert.doesNotMatch(await response.clone().text().catch(() => ''), /sk_live/);
  const body = (await response.json()) as { redirect_url?: string };
  assert.equal(body.redirect_url, REDIRECT);

  let fetched = false;
  const refused = await handleOnrampRequest(
    post({ destination_currency: 'eth', destination_network: 'ethereum', wallet_address: EVM }),
    env({ mode: 'live', stripeSecretKey: TEST_KEY }),
    {
      now: () => 90,
      rateLimit: createRateLimiter(),
      stripe: (input) =>
        createStripeOnrampSession(input, async () => {
          fetched = true;
          throw new Error('fetch should not run');
        }),
    },
  );
  assert.equal(refused.status, 403);
  assert.equal(fetched, false);
  const refusedText = await refused.text();
  assert.match(refusedText, /Test Stripe keys are refused/);
  assert.doesNotMatch(refusedText, /sk_test|sk_live/);
});

test('the deploy entrypoint does not embed a Stripe key', () => {
  const src = readFileSync(new URL('../../api/onramp-session.ts', import.meta.url), 'utf8');
  assert.match(src, /envFromProcess/);
  assert.doesNotMatch(src, /sk_live_|sk_test_[A-Za-z0-9]/);
  const dev = readFileSync(new URL('./dev-server.ts', import.meta.url), 'utf8');
  assert.match(dev, /127\.0\.0\.1/);
  assert.doesNotMatch(dev, /sk_live_|sk_test_[A-Za-z0-9]/);
  const server = readFileSync(new URL('./stripe.ts', import.meta.url), 'utf8') + readFileSync(new URL('./handler.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /console\.(log|info|debug|warn|error)/);
});
