/**
 * Price source for alerts: BoreDash ONLY (https://www.boredash.com/api/wallet/prices), per Patrick (Nov 11 2026).
 * There is deliberately no direct CoinGecko fallback and no separate CoinGecko key.
 *
 * BoreDash's /api/wallet/prices proxies one shared free CoinGecko Demo key (10k calls/month, shared with
 * boredash.com and the wallet's Markets screen) and answers 429 for a minute or two after bursts. So:
 *  - one call per check, with every needed coin id, sorted and de-duplicated (stable URL);
 *  - default every 10 minutes (<= ~4,320 calls/month, and 0 when nobody has an active alert);
 *  - a 429, non-2xx, `{ error }` / `{ status: { error_code } }` body, or bad JSON = skip this cycle, retry next cycle.
 */

export const BOREDASH_PRICES_URL = 'https://www.boredash.com/api/wallet/prices';
/** Keeps the query string well under URL limits; more coins than this are split over a few calls (documented). */
export const MAX_IDS_PER_CALL = 200;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type PriceResult =
  | { ok: true; prices: Record<string, number> }
  | { ok: false; reason: 'rate-limited' | 'http-error' | 'error-body' | 'bad-json' | 'network' };

export function sortedCoinIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim().toLowerCase()).filter(Boolean))].sort();
}

export function boreDashPricesUrl(ids: string[]): string {
  return `${BOREDASH_PRICES_URL}?ids=${encodeURIComponent(sortedCoinIds(ids).join(','))}`;
}

export function parseBoreDashPrices(payload: unknown): Record<string, number> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if ('error' in record || 'status' in record) {
    return null;
  }
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(record)) {
    const usd = (value as { usd?: unknown } | null)?.usd;
    if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
      out[id] = usd;
    }
  }
  return out;
}

/** One BoreDash call for up to MAX_IDS_PER_CALL ids. */
export async function fetchBoreDashPrices(ids: string[], fetchImpl: FetchLike = fetch): Promise<PriceResult> {
  const sorted = sortedCoinIds(ids);
  if (sorted.length === 0) {
    return { ok: true, prices: {} };
  }
  let response: Response;
  try {
    response = await fetchImpl(boreDashPricesUrl(sorted), {
      headers: { Accept: 'application/json', 'User-Agent': 'BoreDefi-Alerts/1.0' },
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (response.status === 429) {
    return { ok: false, reason: 'rate-limited' };
  }
  if (!response.ok) {
    return { ok: false, reason: 'http-error' };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  const prices = parseBoreDashPrices(payload);
  return prices ? { ok: true, prices } : { ok: false, reason: 'error-body' };
}

/** All ids, split only if there are more than MAX_IDS_PER_CALL. Any failed chunk fails the whole cycle. */
export async function fetchAlertPrices(ids: string[], fetchImpl: FetchLike = fetch): Promise<PriceResult & { calls: number }> {
  const sorted = sortedCoinIds(ids);
  const prices: Record<string, number> = {};
  let calls = 0;
  for (let i = 0; i < sorted.length; i += MAX_IDS_PER_CALL) {
    calls += 1;
    const result = await fetchBoreDashPrices(sorted.slice(i, i + MAX_IDS_PER_CALL), fetchImpl);
    if (!result.ok) {
      return { ...result, calls };
    }
    Object.assign(prices, result.prices);
  }
  return { ok: true, prices, calls };
}
