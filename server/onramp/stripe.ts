import { isStripeHostedOnrampUrl } from '../../src/wallet/onramp/url';

export const STRIPE_ONRAMP_API = 'https://api.stripe.com/v1/crypto/onramp_sessions';
/** Public-preview onramp API. v2 is the flat (non-beta-body) parameter shape. */
export const STRIPE_ONRAMP_VERSION = '2026-10-28.endive;crypto_onramp_beta=v2';

export class OnrampRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OnrampRefused';
  }
}

/**
 * Accepts only a test-mode secret key. Live keys (`sk_live`, `rk_live`) are refused
 * even if they were placed in STRIPE_SECRET_KEY_TEST. There is no fallback env var.
 */
export function assertTestSecretKey(value: string | undefined): string {
  const key = value?.normalize('NFKC').trim() ?? '';
  const lower = key.toLowerCase();
  if (!key) {
    throw new OnrampRefused('STRIPE_SECRET_KEY_TEST is not set on the server.', 503);
  }
  if (lower.includes('sk_live') || lower.includes('rk_live')) {
    throw new OnrampRefused('Live Stripe keys are refused. This endpoint runs in test mode only.', 403);
  }
  if (!key.startsWith('sk_test_') || key.length < 'sk_test_'.length + 8) {
    throw new OnrampRefused('Only a Stripe test secret key (sk_test_...) is accepted.', 403);
  }
  return key;
}

export function redactSecrets(value: string): string {
  return value
    .replace(/[sr]k_(test|live)_[A-Za-z0-9_]+/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export type StripeOnrampInput = {
  secretKey: string;
  currency: string;
  network: string;
  walletAddress: string;
  customerIp: string | null;
};

export function stripeOnrampForm(input: StripeOnrampInput): URLSearchParams {
  const body = new URLSearchParams();
  body.set('destination_currency', input.currency);
  body.set('destination_network', input.network);
  // A single-value list locks the asset and network so a later change inside
  // Stripe cannot retarget a chain this wallet does not receive on.
  body.append('destination_currencies[]', input.currency);
  body.append('destination_networks[]', input.network);
  body.set(`wallet_addresses[${input.network}]`, input.walletAddress);
  body.set('lock_wallet_address', 'true');
  body.set('metadata[source]', 'boredefi-wallet');
  if (input.customerIp) {
    body.set('customer_ip_address', input.customerIp);
  }
  return body;
}

export type CreatedOnrampSession = {
  redirectUrl: string;
};

function stripeErrorMessage(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === 'string' && parsed.error.message.trim()) {
      return redactSecrets(parsed.error.message);
    }
  } catch {
    // Fall through to a generic line. Never return the raw body.
  }
  return `Stripe did not start the onramp (${status}).`;
}

export async function createStripeOnrampSession(
  input: StripeOnrampInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedOnrampSession> {
  const secretKey = assertTestSecretKey(input.secretKey);
  let response: Response;
  try {
    response = await fetchImpl(STRIPE_ONRAMP_API, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${secretKey}:`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_ONRAMP_VERSION,
      },
      body: stripeOnrampForm({ ...input, secretKey }),
    });
  } catch {
    throw new OnrampRefused('Could not reach Stripe.', 502);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new OnrampRefused(stripeErrorMessage(text, response.status), 502);
  }
  let parsed: { livemode?: unknown; redirect_url?: unknown };
  try {
    parsed = JSON.parse(text) as { livemode?: unknown; redirect_url?: unknown };
  } catch {
    throw new OnrampRefused('Stripe returned an unreadable onramp session.', 502);
  }
  if (parsed.livemode !== false) {
    throw new OnrampRefused('Stripe returned a live-mode session. This endpoint is test-mode only.', 502);
  }
  if (typeof parsed.redirect_url !== 'string' || !isStripeHostedOnrampUrl(parsed.redirect_url)) {
    throw new OnrampRefused('Stripe did not return a hosted onramp link.', 502);
  }
  return { redirectUrl: parsed.redirect_url };
}
