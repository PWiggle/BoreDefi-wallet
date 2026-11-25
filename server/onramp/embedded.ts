import { findOnrampOffer, type OnrampNetwork } from '../../src/wallet/onramp/offers';
import { addressMatchesFamily } from './addresses';
import {
  assertSecretForMode,
  OnrampRefused,
  redactSecrets,
  STRIPE_ONRAMP_API,
  STRIPE_ONRAMP_VERSION,
  walletAddressKey,
  type OnrampMode,
} from './stripe';

/**
 * Headless CryptoOnrampSession calls for the native embedded onramp.
 * The hosted session keeps STRIPE_ONRAMP_VERSION with no beta suffix.
 * This header is only sent on the embedded session and checkout calls.
 */
export const STRIPE_EMBEDDED_ONRAMP_VERSION = `${STRIPE_ONRAMP_VERSION};crypto_onramp_beta=v2`;

export const LINK_AUTH_API = 'https://login.link.com/v1/link_auth_intent';

/** Pairs registered with Stripe for the embedded onramp. Polygon stays on the hosted flow. */
export const EMBEDDED_NETWORKS: readonly OnrampNetwork[] = ['ethereum', 'base', 'solana'];

const LINK_SCOPES = 'kyc.status:read,crypto:ramp';
const CLIENT_SECRET = /^cos_[A-Za-z0-9]+_secret_[A-Za-z0-9_]+$/;
const SESSION_ID = /^cos_[A-Za-z0-9]+$/;
const AUTH_INTENT_ID = /^lai_[A-Za-z0-9]+$/;

export type EmbeddedCurrency = 'eth' | 'usdc' | 'sol';

export type EmbeddedDestination = {
  currency: EmbeddedCurrency;
  network: 'ethereum' | 'base' | 'solana';
  walletAddress: string;
};

export function embeddedDestination(currency: string, network: string, wallet: string): EmbeddedDestination {
  const offer = findOnrampOffer(currency, network);
  if (!offer || (offer.currency !== 'eth' && offer.currency !== 'usdc' && offer.currency !== 'sol')) {
    throw new OnrampRefused('That asset and network combination is not available in the app.', 400);
  }
  if (!EMBEDDED_NETWORKS.includes(offer.network as EmbeddedDestination['network'])) {
    throw new OnrampRefused('That network is only available in the browser checkout.', 400);
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
  return {
    currency: offer.currency,
    network: offer.network as EmbeddedDestination['network'],
    walletAddress,
  };
}

/** Dollars, two decimal places, no fee added. Sandbox purchases should stay at or under 100. */
export function normalizeSourceAmount(value: string): string {
  const trimmed = value.trim();
  if (trimmed !== value || !/^\d{1,5}(\.\d{1,2})?$/.test(trimmed)) {
    throw new OnrampRefused('Enter a USD amount with at most two decimal places.', 400);
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
    throw new OnrampRefused('Enter a USD amount greater than 0 and at most 10000.', 400);
  }
  return amount.toFixed(2);
}

export function stripeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || !/^[A-Za-z0-9_]{8,128}$/.test(value)) {
    throw new OnrampRefused(`${label} was not accepted.`, 400);
  }
  return value;
}

export function parseEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new OnrampRefused('Enter a valid email address.', 400);
  }
  const email = value.trim();
  if (email !== value || email.length > 800 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OnrampRefused('Enter a valid email address.', 400);
  }
  return email;
}

function stripeFailure(text: string, status: number): OnrampRefused {
  let code = '';
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown; code?: unknown } | string };
    const error = parsed.error;
    if (error && typeof error === 'object' && error.code === 'crypto_onramp_missing_document_verification') {
      return new OnrampRefused('Identity verification is required before this purchase.', 409);
    }
    if (error && typeof error === 'object' && typeof error.code === 'string') {
      code = error.code;
    }
    const message =
      typeof error === 'string' ? error : error && typeof error === 'object' ? error.message : undefined;
    if (typeof message === 'string' && message.trim()) {
      return new OnrampRefused(redactSecrets(message), status >= 500 ? 502 : 502);
    }
  } catch {
    // Fall through. Never return the raw body.
  }
  if (code === 'crypto_onramp_missing_document_verification') {
    return new OnrampRefused('Identity verification is required before this purchase.', 409);
  }
  return new OnrampRefused('Stripe did not start the in-app checkout.', 502);
}

async function stripeFetch(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new OnrampRefused('Could not reach Stripe.', 502);
  }
  const text = await response.text();
  if (!response.ok) {
    throw stripeFailure(text, response.status);
  }
  return text;
}

function assertTestMode(livemode: unknown, mode: OnrampMode): void {
  if (mode === 'live') {
    throw new OnrampRefused('In-app checkout is test mode only.', 403);
  }
  if (livemode !== false) {
    throw new OnrampRefused('Stripe returned a live-mode session. This endpoint is test-mode only.', 502);
  }
}

export async function createLinkAuthIntent(input: {
  secretKey: string;
  mode?: OnrampMode;
  email: string;
  oauthClientId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ authIntentId: string }> {
  const mode = input.mode ?? 'test';
  if (mode !== 'test') {
    throw new OnrampRefused('In-app checkout is test mode only.', 403);
  }
  const secretKey = assertSecretForMode('test', input.secretKey);
  const oauthClientId = input.oauthClientId.trim();
  if (!oauthClientId || oauthClientId.length > 200 || /\s/.test(oauthClientId)) {
    throw new OnrampRefused('In-app checkout is not configured on the server.', 503);
  }
  const text = await stripeFetch(
    LINK_AUTH_API,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: input.email,
        oauth_client_id: oauthClientId,
        oauth_scopes: LINK_SCOPES,
      }),
    },
    input.fetchImpl ?? fetch,
  );
  let parsed: { id?: unknown };
  try {
    parsed = JSON.parse(text) as { id?: unknown };
  } catch {
    throw new OnrampRefused('Stripe returned an unreadable Link authorization.', 502);
  }
  if (typeof parsed.id !== 'string' || !AUTH_INTENT_ID.test(parsed.id)) {
    throw new OnrampRefused('Stripe did not start Link authorization.', 502);
  }
  return { authIntentId: parsed.id };
}

async function accessToken(input: {
  secretKey: string;
  authIntentId: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  if (!AUTH_INTENT_ID.test(input.authIntentId)) {
    throw new OnrampRefused('Link authorization was not accepted.', 400);
  }
  const text = await stripeFetch(
    `${LINK_AUTH_API}/${encodeURIComponent(input.authIntentId)}/tokens`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.secretKey}` },
    },
    input.fetchImpl,
  );
  let parsed: { access_token?: unknown };
  try {
    parsed = JSON.parse(text) as { access_token?: unknown };
  } catch {
    throw new OnrampRefused('Stripe did not authorize this purchase.', 502);
  }
  if (typeof parsed.access_token !== 'string' || !parsed.access_token.startsWith('liwltoken_')) {
    throw new OnrampRefused('Stripe did not authorize this purchase.', 502);
  }
  return parsed.access_token;
}

export function embeddedSessionForm(input: {
  cryptoCustomerId: string;
  cryptoPaymentToken: string;
  currency: EmbeddedCurrency;
  network: EmbeddedDestination['network'];
  walletAddress: string;
  sourceAmount: string;
  customerIp: string | null;
}): URLSearchParams {
  const body = new URLSearchParams();
  const addressKey = walletAddressKey(input.network);
  body.set('ui_mode', 'headless');
  body.set('crypto_customer_id', input.cryptoCustomerId);
  body.set('crypto_payment_token', input.cryptoPaymentToken);
  body.set('source_currency', 'usd');
  body.set('source_amount', input.sourceAmount);
  body.set('destination_currency', input.currency);
  body.set('destination_network', input.network);
  body.append('destination_currencies[]', input.currency);
  body.append('destination_networks[]', input.network);
  body.set(`wallet_addresses[${addressKey}]`, input.walletAddress);
  body.set('lock_wallet_address', 'true');
  body.set('metadata[source]', 'boredefi-wallet');
  if (input.customerIp) {
    body.set('customer_ip_address', input.customerIp);
  }
  return body;
}

export async function createEmbeddedOnrampSession(input: {
  secretKey: string;
  mode?: OnrampMode;
  authIntentId: string;
  cryptoCustomerId: string;
  cryptoPaymentToken: string;
  currency: EmbeddedCurrency;
  network: EmbeddedDestination['network'];
  walletAddress: string;
  sourceAmount: string;
  customerIp: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ sessionId: string }> {
  const mode = input.mode ?? 'test';
  if (mode !== 'test') {
    throw new OnrampRefused('In-app checkout is test mode only.', 403);
  }
  const secretKey = assertSecretForMode('test', input.secretKey);
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await accessToken({ secretKey, authIntentId: input.authIntentId, fetchImpl });
  const text = await stripeFetch(
    STRIPE_ONRAMP_API,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${secretKey}:`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_EMBEDDED_ONRAMP_VERSION,
        'Stripe-OAuth-Token': token,
      },
      body: embeddedSessionForm(input).toString(),
    },
    fetchImpl,
  );
  let parsed: { id?: unknown; livemode?: unknown };
  try {
    parsed = JSON.parse(text) as { id?: unknown; livemode?: unknown };
  } catch {
    throw new OnrampRefused('Stripe returned an unreadable onramp session.', 502);
  }
  assertTestMode(parsed.livemode, mode);
  if (typeof parsed.id !== 'string' || !SESSION_ID.test(parsed.id)) {
    throw new OnrampRefused('Stripe did not start the in-app checkout.', 502);
  }
  return { sessionId: parsed.id };
}

export async function checkoutEmbeddedOnrampSession(input: {
  secretKey: string;
  mode?: OnrampMode;
  authIntentId: string;
  sessionId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ clientSecret: string }> {
  const mode = input.mode ?? 'test';
  if (mode !== 'test') {
    throw new OnrampRefused('In-app checkout is test mode only.', 403);
  }
  if (!SESSION_ID.test(input.sessionId)) {
    throw new OnrampRefused('The in-app checkout session was not accepted.', 400);
  }
  const secretKey = assertSecretForMode('test', input.secretKey);
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await accessToken({ secretKey, authIntentId: input.authIntentId, fetchImpl });
  const text = await stripeFetch(
    `${STRIPE_ONRAMP_API}/${encodeURIComponent(input.sessionId)}/checkout`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${secretKey}:`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_EMBEDDED_ONRAMP_VERSION,
        'Stripe-OAuth-Token': token,
      },
    },
    fetchImpl,
  );
  let parsed: { livemode?: unknown; client_secret?: unknown };
  try {
    parsed = JSON.parse(text) as { livemode?: unknown; client_secret?: unknown };
  } catch {
    throw new OnrampRefused('Stripe returned an unreadable checkout.', 502);
  }
  assertTestMode(parsed.livemode, mode);
  if (typeof parsed.client_secret !== 'string' || !CLIENT_SECRET.test(parsed.client_secret)) {
    throw new OnrampRefused('Stripe did not return a checkout secret.', 502);
  }
  return { clientSecret: parsed.client_secret };
}
