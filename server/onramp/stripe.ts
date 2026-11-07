import { isStripeHostedOnrampUrl } from '../../src/wallet/onramp/url';

export const STRIPE_ONRAMP_API = 'https://api.stripe.com/v1/crypto/onramp_sessions';
/**
 * Version this Stripe account accepts. A `crypto_onramp_beta=v2` suffix is rejected
 * ("You do not have permission to pass this beta header").
 */
export const STRIPE_ONRAMP_VERSION = '2026-10-28.endive';

/**
 * `wallet_addresses` keys from the Crypto Onramp Session object. They are not the
 * `destination_network` enum: Base is `base_network`, not `base`. There is no
 * avalanche key, so Avalanche is not offered.
 * https://docs.stripe.com/api/crypto/onramp_sessions/object
 */
const WALLET_ADDRESS_KEYS: Record<string, string> = {
  ethereum: 'ethereum',
  base: 'base_network',
  polygon: 'polygon',
  solana: 'solana',
};

export function walletAddressKey(network: string): string {
  const key = WALLET_ADDRESS_KEYS[network];
  if (!key) {
    throw new OnrampRefused('That network has no Stripe wallet address field.', 400);
  }
  return key;
}

export class OnrampRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OnrampRefused';
  }
}

export type OnrampMode = 'test' | 'live';

/** Only the exact value `live` selects live mode. Anything else stays in test mode. */
export function onrampMode(value: string | undefined): OnrampMode {
  return value?.trim().toLowerCase() === 'live' ? 'live' : 'test';
}

function normalizedKey(value: string | undefined): string {
  return value?.normalize('NFKC').trim() ?? '';
}

/**
 * Accepts only a test-mode secret key. Live keys (`sk_live`, `rk_live`) are refused
 * even if they were placed in STRIPE_SECRET_KEY_TEST. There is no fallback env var.
 */
export function assertTestSecretKey(value: string | undefined): string {
  const key = normalizedKey(value);
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

/** Accepts only a live secret (`sk_live_` or `rk_live_`). Test keys are refused. */
export function assertLiveSecretKey(value: string | undefined): string {
  const key = normalizedKey(value);
  const lower = key.toLowerCase();
  if (!key) {
    throw new OnrampRefused('STRIPE_SECRET_KEY_LIVE is not set on the server.', 503);
  }
  if (lower.includes('sk_test') || lower.includes('rk_test')) {
    throw new OnrampRefused('Test Stripe keys are refused in live mode.', 403);
  }
  const livePrefix = key.startsWith('sk_live_') ? 'sk_live_' : key.startsWith('rk_live_') ? 'rk_live_' : null;
  if (!livePrefix || key.length < livePrefix.length + 8) {
    throw new OnrampRefused('Live mode requires a live Stripe secret key (sk_live_ or rk_live_).', 403);
  }
  return key;
}

export function assertSecretForMode(mode: OnrampMode, value: string | undefined): string {
  return mode === 'live' ? assertLiveSecretKey(value) : assertTestSecretKey(value);
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
  /** Defaults to test so a forgotten mode cannot create a live session. */
  mode?: OnrampMode;
  currency: string;
  network: string;
  walletAddress: string;
  customerIp: string | null;
};

export function stripeOnrampForm(input: StripeOnrampInput): URLSearchParams {
  const body = new URLSearchParams();
  const addressKey = walletAddressKey(input.network);
  body.set('destination_currency', input.currency);
  body.set('destination_network', input.network);
  // A single-value list locks the asset and network so a later change inside
  // Stripe cannot retarget a chain this wallet does not receive on.
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
  const mode = input.mode ?? 'test';
  const secretKey = assertSecretForMode(mode, input.secretKey);
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
  if (mode === 'live') {
    if (parsed.livemode !== true) {
      throw new OnrampRefused('Stripe did not return a live-mode session.', 502);
    }
  } else if (parsed.livemode !== false) {
    throw new OnrampRefused('Stripe returned a live-mode session. This endpoint is test-mode only.', 502);
  }
  if (typeof parsed.redirect_url !== 'string' || !isStripeHostedOnrampUrl(parsed.redirect_url)) {
    throw new OnrampRefused('Stripe did not return a hosted onramp link.', 502);
  }
  return { redirectUrl: parsed.redirect_url };
}
