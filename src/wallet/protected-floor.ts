import { protectedAssetByKey } from './yuga-allowlist';

/**
 * Collection floor prices for the listing check. Uses Alchemy getFloorPrice (OpenSea + LooksRare), keeps
 * only floors refreshed in the last 7 days, and takes the higher one so the "under half of floor" block
 * errs on the side of blocking. Cached for 10 minutes. Returns null when unknown (the guard then blocks
 * the listing rather than guess).
 */
type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const CACHE_MS = 10 * 60 * 1000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; wei: bigint | null }>();

type FloorEntry = { floorPrice?: number; priceCurrency?: string; retrievedAt?: string; error?: unknown };

export function parseFloorResponse(body: unknown, now = Date.now()): bigint | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  let best: bigint | null = null;
  for (const entry of Object.values(body as Record<string, FloorEntry>)) {
    if (!entry || typeof entry !== 'object' || entry.error || entry.priceCurrency !== 'ETH') {
      continue;
    }
    const price = entry.floorPrice;
    const at = entry.retrievedAt ? Date.parse(entry.retrievedAt) : NaN;
    if (typeof price !== 'number' || !(price > 0) || !Number.isFinite(at) || now - at > STALE_MS) {
      continue;
    }
    const wei = BigInt(Math.round(price * 1e6)) * 10n ** 12n;
    if (best === null || wei > best) {
      best = wei;
    }
  }
  return best;
}

export function cachedFloorWei(assetKey: string, now = Date.now()): bigint | null {
  const hit = cache.get(assetKey);
  return hit && now - hit.at < CACHE_MS ? hit.wei : null;
}

export async function fetchFloorWei(
  assetKey: string,
  alchemyKey: string | null,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now = Date.now(),
): Promise<bigint | null> {
  const hit = cache.get(assetKey);
  if (hit && now - hit.at < CACHE_MS) {
    return hit.wei;
  }
  const asset = protectedAssetByKey(assetKey);
  if (!asset || asset.chainId !== 1 || asset.standard === 'ERC-20' || !alchemyKey) {
    return null;
  }
  try {
    const url = `https://eth-mainnet.g.alchemy.com/nft/v3/${encodeURIComponent(alchemyKey)}/getFloorPrice?contractAddress=${asset.address}`;
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    const wei = response.ok ? parseFloorResponse(await response.json(), now) : null;
    if (wei !== null) {
      cache.set(assetKey, { at: now, wei });
    }
    return wei;
  } catch {
    return null;
  }
}
