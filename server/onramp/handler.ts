import { timingSafeEqual, createHash } from 'node:crypto';

import { findOnrampOffer } from '../../src/wallet/onramp/offers';
import { addressMatchesFamily } from './addresses';
import {
  createStripeOnrampSession,
  onrampMode,
  OnrampRefused,
  type CreatedOnrampSession,
  type OnrampMode,
  type StripeOnrampInput,
} from './stripe';

export type OnrampServerEnv = {
  mode: OnrampMode;
  stripeSecretKey: string | undefined;
  allowedOrigins: string | undefined;
  appToken: string | undefined;
};

export type RateLimiter = {
  take(key: string, now: number): boolean;
};

export type OnrampDeps = {
  stripe?: (input: StripeOnrampInput) => Promise<CreatedOnrampSession>;
  rateLimit?: RateLimiter;
  now?: () => number;
};

const BODY_LIMIT = 4096;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const REQUEST_FIELDS = new Set(['destination_currency', 'destination_network', 'wallet_address']);

export function envFromProcess(source: { [key: string]: string | undefined } = process.env): OnrampServerEnv {
  const mode = onrampMode(source.ONRAMP_MODE);
  return {
    mode,
    // Live mode never reads the test key, and test mode never reads the live key.
    stripeSecretKey: mode === 'live' ? source.STRIPE_SECRET_KEY_LIVE : source.STRIPE_SECRET_KEY_TEST,
    allowedOrigins: source.ONRAMP_ALLOWED_ORIGINS,
    appToken: source.ONRAMP_APP_TOKEN,
  };
}

export function createRateLimiter(limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(key, now) {
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) {
          hits.delete(oldest);
        }
      }
      return true;
    },
  };
}

const defaultRateLimit = createRateLimiter();

export function parseAllowlist(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  const origins: string[] = [];
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    try {
      origins.push(new URL(trimmed).origin);
    } catch {
      // Ignore a bad entry rather than failing the whole server.
    }
  }
  return origins;
}

/** Native apps send no Origin. Browsers must be localhost or on the allowlist. */
export function originAllowed(origin: string | null, allowlist: string[]): boolean {
  if (!origin) {
    return true;
  }
  if (origin === 'null') {
    return false;
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) {
    return false;
  }
  const loopback = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (loopback) {
    return true;
  }
  return allowlist.includes(url.origin);
}

export function isIpAddress(value: string): boolean {
  const parts = value.split('.');
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    return true;
  }
  return value.includes(':') && /^[0-9a-fA-F:]+$/.test(value) && value.length <= 45;
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  if (isIpAddress(forwarded)) {
    return forwarded;
  }
  const real = request.headers.get('x-real-ip')?.trim() ?? '';
  if (isIpAddress(real)) {
    return real;
  }
  return null;
}

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

function validateBody(value: unknown): { currency: string; network: string; walletAddress: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OnrampRefused('Send a JSON object.', 400);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!REQUEST_FIELDS.has(key)) {
      throw new OnrampRefused('Unexpected field in the request.', 400);
    }
  }
  const currency = record.destination_currency;
  const network = record.destination_network;
  const wallet = record.wallet_address;
  if (typeof currency !== 'string' || typeof network !== 'string' || typeof wallet !== 'string') {
    throw new OnrampRefused('Asset, network, and wallet address are required.', 400);
  }
  if (currency.length > 32 || network.length > 32 || wallet.length > 128) {
    throw new OnrampRefused('Asset, network, or address is too long.', 400);
  }
  const offer = findOnrampOffer(currency, network);
  if (!offer) {
    throw new OnrampRefused('That asset and network combination is not available.', 400);
  }
  const walletAddress = wallet.trim();
  if (walletAddress !== wallet || !addressMatchesFamily(walletAddress, offer.family)) {
    throw new OnrampRefused(
      offer.family === 'solana'
        ? 'That is not a valid Solana receiving address.'
        : 'That is not a valid Ethereum-style receiving address.',
      400,
    );
  }
  return { currency: offer.currency, network: offer.network, walletAddress };
}

export async function handleOnrampRequest(request: Request, env: OnrampServerEnv, deps: OnrampDeps = {}): Promise<Response> {
  const origin = request.headers.get('origin');
  const allowlist = parseAllowlist(env.allowedOrigins);
  const allowedOrigin = originAllowed(origin, allowlist);
  const cors = corsHeaders(origin, allowedOrigin);
  const method = request.method.toUpperCase();
  const limiter = deps.rateLimit ?? defaultRateLimit;
  const now = deps.now?.() ?? Date.now();
  const ip = clientIp(request) ?? 'unknown';
  if (!limiter.take(ip, now)) {
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

  try {
    const body = validateBody(parsed);
    const stripe = deps.stripe ?? createStripeOnrampSession;
    const session = await stripe({
      secretKey: env.stripeSecretKey ?? '',
      mode: env.mode,
      currency: body.currency,
      network: body.network,
      walletAddress: body.walletAddress,
      customerIp: clientIp(request),
    });
    return json(200, { redirect_url: session.redirectUrl }, cors);
  } catch (error) {
    if (error instanceof OnrampRefused) {
      return json(error.status, { error: error.message }, cors);
    }
    return json(502, { error: 'Could not start the Stripe onramp.' }, cors);
  }
}
