/**
 * Buy crypto (Stripe hosted onramp). Default OFF in release builds.
 *
 *  - EXPO_PUBLIC_BUY_CRYPTO=1  turns it on in any build, including a store build.
 *  - EXPO_PUBLIC_BUY_CRYPTO=0  forces it off, even in dev.
 *  - unset                   on only in __DEV__, off in every release/store build.
 *
 * The endpoint base URL is EXPO_PUBLIC_ONRAMP_URL (https, or http://localhost for a local server).
 * A missing URL, or the eas.json placeholder https://REPLACE_ME/api/onramp-session, hides Buy.
 * EXPO_PUBLIC_ONRAMP_TOKEN is optional and not a secret: it is bundled into the app.
 * EXPO_PUBLIC_VERCEL_BYPASS is optional and must stay unset on store builds. When set, it is sent
 * only as the Vercel Deployment Protection header. The Stripe secret key is never read here.
 *
 * Expo only inlines literal `process.env.EXPO_PUBLIC_*` reads, so each one below is read literally.
 */
const BUILD_BUY_FLAG: string | undefined = process.env.EXPO_PUBLIC_BUY_CRYPTO;
const BUILD_ONRAMP_URL: string | undefined = process.env.EXPO_PUBLIC_ONRAMP_URL;
const BUILD_ONRAMP_TOKEN: string | undefined = process.env.EXPO_PUBLIC_ONRAMP_TOKEN;
const BUILD_VERCEL_BYPASS: string | undefined = process.env.EXPO_PUBLIC_VERCEL_BYPASS;

declare const __DEV__: boolean | undefined;

export function buyCryptoEnabled(flag: string | undefined, dev: boolean): boolean {
  const value = flag?.trim();
  if (value === '1' || value === 'true') {
    return true;
  }
  if (value === '0' || value === 'false') {
    return false;
  }
  return dev;
}

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__ === true;

export const BUY_CRYPTO_ENABLED = buyCryptoEnabled(BUILD_BUY_FLAG, IS_DEV);

/** The eas.json production placeholder, and any other unset host, must not open Buy. */
export function isOnrampPlaceholder(value: string | undefined): boolean {
  return /replace_me/i.test(value ?? '');
}

/** Buy is shown only when the flag is on and the endpoint is a real URL. */
export function buyCryptoVisible(flag: string | undefined, dev: boolean, endpointBase: string | undefined): boolean {
  if (!buyCryptoEnabled(flag, dev) || isOnrampPlaceholder(endpointBase)) {
    return false;
  }
  return onrampEndpointUrl(endpointBase) !== null;
}

/** True for the onramp endpoint the app is allowed to call. */
export function isAllowedOnrampEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) {
    return false;
  }
  const loopback = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !loopback) {
    return false;
  }
  return url.pathname.endsWith('/api/onramp-session');
}

/**
 * Accepts either the server origin (`https://preview.vercel.app`) or the full
 * endpoint (`https://preview.vercel.app/api/onramp-session`).
 */
export function onrampEndpointUrl(base: string | undefined): string | null {
  const trimmed = base?.trim() ?? '';
  if (!trimmed) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password || isOnrampPlaceholder(trimmed)) {
    return null;
  }
  const loopback = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !loopback) {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/api/onramp-session') ? path || '/api/onramp-session' : `${path}/api/onramp-session`;
  url.search = '';
  url.hash = '';
  const endpoint = url.toString();
  return isAllowedOnrampEndpoint(endpoint) ? endpoint : null;
}

export function onrampAppToken(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

/** Sent only when set. Store builds leave EXPO_PUBLIC_VERCEL_BYPASS unset. */
export function vercelBypassToken(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

export const ONRAMP_ENDPOINT = onrampEndpointUrl(BUILD_ONRAMP_URL);
export const ONRAMP_APP_TOKEN = onrampAppToken(BUILD_ONRAMP_TOKEN);
export const ONRAMP_VERCEL_BYPASS = vercelBypassToken(BUILD_VERCEL_BYPASS);
/** Home and the Buy route. Hidden when the flag is off or the URL is missing or a placeholder. */
export const BUY_CRYPTO_VISIBLE = buyCryptoVisible(BUILD_BUY_FLAG, IS_DEV, BUILD_ONRAMP_URL);
