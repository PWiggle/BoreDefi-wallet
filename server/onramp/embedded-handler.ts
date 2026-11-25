import { timingSafeEqual, createHash } from 'node:crypto';

import {
  checkoutEmbeddedOnrampSession,
  createEmbeddedOnrampSession,
  createLinkAuthIntent,
  embeddedDestination,
  normalizeSourceAmount,
  parseEmail,
  stripeId,
} from './embedded';
import { clientIp, createRateLimiter, originAllowed, parseAllowlist, type OnrampServerEnv, type RateLimiter } from './handler';
import { OnrampRefused } from './stripe';

const BODY_LIMIT = 4096;

export type EmbeddedDeps = {
  rateLimit?: RateLimiter;
  now?: () => number;
  fetchImpl?: typeof fetch;
};

const defaultRateLimit = createRateLimiter();

function tokensMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function json(status: number, body: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
}

function corsHeaders(origin: string | null, allowed: boolean): Record<string, string> {
  if (!origin || !allowed) {
    return {};
  }
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-boredefi-onramp',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function rejectExtra(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new OnrampRefused('Unexpected field in the request.', 400);
    }
  }
}

export async function handleEmbeddedOnrampRequest(
  request: Request,
  env: OnrampServerEnv,
  deps: EmbeddedDeps = {},
): Promise<Response> {
  const origin = request.headers.get('origin');
  const allowlist = parseAllowlist(env.allowedOrigins);
  const allowedOrigin = originAllowed(origin, allowlist);
  const cors = corsHeaders(origin, allowedOrigin);
  const method = request.method.toUpperCase();
  const limiter = deps.rateLimit ?? defaultRateLimit;
  const now = deps.now?.() ?? Date.now();
  const ip = clientIp(request) ?? 'unknown';
  if (!limiter.take(`${ip}:embedded`, now)) {
    return json(429, { error: 'Too many buy attempts. Wait a minute and try again.' }, { ...cors, 'retry-after': '60' });
  }
  if (!allowedOrigin) {
    return json(403, { error: 'This origin is not allowed to start a purchase.' }, cors);
  }
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...cors } });
  }
  if (method !== 'POST') {
    return json(405, { error: 'Use POST.' }, cors);
  }
  if (env.mode !== 'test') {
    return json(403, { error: 'In-app checkout is test mode only.' }, cors);
  }

  const expectedToken = env.appToken?.trim() ?? '';
  if (expectedToken) {
    const provided = request.headers.get('x-boredefi-onramp') ?? '';
    if (!provided || !tokensMatch(provided, expectedToken)) {
      return json(401, { error: 'This app is not allowed to start a purchase.' }, cors);
    }
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return json(415, { error: 'Send JSON.' }, cors);
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > BODY_LIMIT) {
    return json(413, { error: 'Request is too large.' }, cors);
  }

  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return json(400, { error: 'Could not read the request.' }, cors);
  }
  if (raw.length > BODY_LIMIT) {
    return json(413, { error: 'Request is too large.' }, cors);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return json(400, { error: 'Request JSON is invalid.' }, cors);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return json(400, { error: 'Send a JSON object.' }, cors);
  }

  try {
    const record = parsed as Record<string, unknown>;
    const action = record.action;
    const fetchImpl = deps.fetchImpl ?? fetch;
    const secretKey = env.stripeSecretKey ?? '';
    if (action === 'link_auth') {
      rejectExtra(record, ['action', 'email']);
      const created = await createLinkAuthIntent({
        secretKey,
        mode: 'test',
        email: parseEmail(record.email),
        oauthClientId: env.linkOauthClientId ?? '',
        fetchImpl,
      });
      return json(200, { auth_intent_id: created.authIntentId }, cors);
    }
    if (action === 'session') {
      rejectExtra(record, [
        'action',
        'auth_intent_id',
        'crypto_customer_id',
        'crypto_payment_token',
        'destination_currency',
        'destination_network',
        'wallet_address',
        'source_amount',
      ]);
      if (typeof record.destination_currency !== 'string' || typeof record.destination_network !== 'string') {
        throw new OnrampRefused('Asset, network, and wallet address are required.', 400);
      }
      if (typeof record.wallet_address !== 'string' || typeof record.source_amount !== 'string') {
        throw new OnrampRefused('Asset, network, and wallet address are required.', 400);
      }
      const destination = embeddedDestination(record.destination_currency, record.destination_network, record.wallet_address);
      const session = await createEmbeddedOnrampSession({
        secretKey,
        mode: 'test',
        authIntentId: stripeId(record.auth_intent_id, 'Link authorization'),
        cryptoCustomerId: stripeId(record.crypto_customer_id, 'Customer'),
        cryptoPaymentToken: stripeId(record.crypto_payment_token, 'Payment token'),
        currency: destination.currency,
        network: destination.network,
        walletAddress: destination.walletAddress,
        sourceAmount: normalizeSourceAmount(record.source_amount),
        customerIp: clientIp(request),
        fetchImpl,
      });
      return json(200, { session_id: session.sessionId }, cors);
    }
    if (action === 'checkout') {
      rejectExtra(record, ['action', 'auth_intent_id', 'session_id']);
      const checkout = await checkoutEmbeddedOnrampSession({
        secretKey,
        mode: 'test',
        authIntentId: stripeId(record.auth_intent_id, 'Link authorization'),
        sessionId: stripeId(record.session_id, 'Checkout session'),
        fetchImpl,
      });
      return json(200, { client_secret: checkout.clientSecret }, cors);
    }
    throw new OnrampRefused('Unknown in-app checkout action.', 400);
  } catch (error) {
    if (error instanceof OnrampRefused) {
      return json(error.status, { error: error.message }, cors);
    }
    return json(502, { error: 'Could not start the in-app checkout.' }, cors);
  }
}
