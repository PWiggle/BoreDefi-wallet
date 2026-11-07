/** Exact host of Stripe's hosted onramp. Anything else is treated as a phishing redirect. */
const STRIPE_ONRAMP_HOST = 'crypto.link.com';

export function isStripeHostedOnrampUrl(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.hostname === STRIPE_ONRAMP_HOST && url.username === '' && url.password === '';
}
