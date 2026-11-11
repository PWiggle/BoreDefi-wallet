/**
 * Push notifications + price alerts.
 *
 * EXPO_PUBLIC_ALERTS_API_URL = the deployed alerts Worker (server/alerts), e.g. https://boredefi-alerts.<acct>.workers.dev
 * Unset (today) = the Notifications row stays hidden in Settings, so store builds are unchanged until the
 * server is live and Patrick says yes.
 *
 * Expo only inlines literal `process.env.EXPO_PUBLIC_*` reads.
 */
const BUILD_ALERTS_API_URL: string | undefined = process.env.EXPO_PUBLIC_ALERTS_API_URL;

export function normalizeAlertsUrl(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+/i.test(trimmed) ? trimmed : '';
}

export const ALERTS_API_URL = normalizeAlertsUrl(BUILD_ALERTS_API_URL);
export const ALERTS_ENABLED = ALERTS_API_URL !== '';

/** Shown on the screen; matches PRICE_CHECK_MINUTES on the server. */
export const PRICE_CHECK_MINUTES = 10;
