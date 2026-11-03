import { getAddress, isAddress } from 'ethers';

import { logger } from '../logger';
import type { ActivityItem } from './activity';
import type { ChainId } from './chains';
import type { NftFetchResult, NftItem } from './nfts';

/**
 * Optional Alchemy-backed NFT and activity provider.
 * Enabled only when EXPO_PUBLIC_ALCHEMY_KEY is set at build time (EAS env or .env, never committed).
 * Blockscout stays the fallback for every chain and for any Alchemy failure.
 * Note: EXPO_PUBLIC_* values are bundled into the app, so use a key restricted to these APIs.
 */
export const ALCHEMY_NETWORK: Record<ChainId, string> = {
  1: 'eth-mainnet',
  10: 'opt-mainnet',
  8453: 'base-mainnet',
  42161: 'arb-mainnet',
  137: 'polygon-mainnet',
  56: 'bnb-mainnet',
  43114: 'avax-mainnet',
  33139: 'apechain-mainnet',
};

/** Chains that use Alchemy first (Blockscout blocks app clients there, or has no endpoint). */
export const ALCHEMY_CHAINS: ReadonlySet<ChainId> = new Set<ChainId>([8453, 137, 42161, 56]);

/**
 * Expo inlines only literal `process.env.EXPO_PUBLIC_*` reads at bundle time. Reading through a variable
 * (for example `env.EXPO_PUBLIC_ALCHEMY_KEY` with `env = process.env`) leaves it undefined in release
 * builds, so the literal read below is required.
 */
const BUILD_ALCHEMY_KEY: string | undefined = process.env.EXPO_PUBLIC_ALCHEMY_KEY;

export function getAlchemyKey(env?: Record<string, string | undefined>): string | null {
  const key = (env ? env.EXPO_PUBLIC_ALCHEMY_KEY : BUILD_ALCHEMY_KEY)?.trim();
  return key ? key : null;
}

export function alchemyEnabledFor(chainId: ChainId, key: string | null = getAlchemyKey()): boolean {
  return Boolean(key) && ALCHEMY_CHAINS.has(chainId);
}

type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const TIMEOUT_MS = 15_000;

async function withTimeout<T>(run: (signal?: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await run(controller?.signal);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

type AlchemyNft = {
  contract?: { address?: string; name?: string; tokenType?: string; openSeaMetadata?: { collectionName?: string } };
  tokenId?: string;
  tokenType?: string;
  name?: string;
  image?: { cachedUrl?: string; thumbnailUrl?: string; originalUrl?: string };
  raw?: { metadata?: { name?: string; image?: string } };
};

function standardOf(value: string | undefined): NftItem['standard'] | null {
  const upper = (value ?? '').toUpperCase();
  if (upper.includes('1155')) {
    return 'ERC-1155';
  }
  if (upper.includes('721')) {
    return 'ERC-721';
  }
  return null;
}

export function parseAlchemyNfts(items: AlchemyNft[], chainId: ChainId): NftItem[] {
  const out: NftItem[] = [];
  for (const item of items) {
    const contract = item.contract?.address;
    const standard = standardOf(item.tokenType ?? item.contract?.tokenType);
    const tokenId = item.tokenId;
    if (!contract || !isAddress(contract) || !standard || !tokenId) {
      continue;
    }
    out.push({
      chainId,
      contract: getAddress(contract),
      tokenId,
      standard,
      name: item.name ?? item.raw?.metadata?.name ?? `#${tokenId}`,
      collection: item.contract?.name ?? item.contract?.openSeaMetadata?.collectionName ?? 'NFT',
      imageUrl: item.image?.cachedUrl ?? item.image?.originalUrl ?? item.raw?.metadata?.image,
      ...((item.raw?.metadata?.image ?? item.image?.originalUrl) ? { imageOriginal: item.raw?.metadata?.image ?? item.image?.originalUrl } : {}),
    });
  }
  return out;
}

export async function fetchAlchemyNfts(
  owner: string,
  chainId: ChainId,
  key: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = TIMEOUT_MS,
): Promise<NftFetchResult> {
  const url =
    `https://${ALCHEMY_NETWORK[chainId]}.g.alchemy.com/nft/v3/${encodeURIComponent(key)}/getNFTsForOwner` +
    `?owner=${owner}&withMetadata=true&pageSize=100`;
  try {
    return await withTimeout(async (signal) => {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
      if (response.status === 404) {
        return { items: [], autodetect: 'ok' } as NftFetchResult;
      }
      if (!response.ok) {
        logger.warn('Alchemy NFTs unavailable', { chainId, status: response.status });
        return { items: [], autodetect: 'unavailable' } as NftFetchResult;
      }
      const body = (await response.json()) as { ownedNfts?: unknown } | null;
      const items = Array.isArray(body?.ownedNfts) ? (body.ownedNfts as AlchemyNft[]) : [];
      return { items: parseAlchemyNfts(items, chainId), autodetect: 'ok' } as NftFetchResult;
    }, timeoutMs);
  } catch (error) {
    logger.warn('Alchemy NFTs unavailable', { chainId, message: error instanceof Error ? error.message : 'unknown' });
    return { items: [], autodetect: 'unavailable' };
  }
}

type AlchemyTransfer = {
  hash?: string;
  from?: string;
  to?: string | null;
  rawContract?: { value?: string | null };
  value?: number | null;
  metadata?: { blockTimestamp?: string };
};

export function parseAlchemyTransfers(transfers: AlchemyTransfer[], owner: string): ActivityItem[] {
  const lower = owner.toLowerCase();
  const seen = new Set<string>();
  const out: ActivityItem[] = [];
  for (const tx of transfers) {
    if (!tx.hash || seen.has(tx.hash)) {
      continue;
    }
    seen.add(tx.hash);
    const raw = tx.rawContract?.value;
    let valueWei = 0n;
    try {
      valueWei = raw ? BigInt(raw) : 0n;
    } catch {
      valueWei = 0n;
    }
    const time = tx.metadata?.blockTimestamp ? Date.parse(tx.metadata.blockTimestamp) : NaN;
    out.push({
      hash: tx.hash,
      from: tx.from ?? '',
      to: tx.to ?? '',
      valueWei,
      timestamp: Number.isFinite(time) ? Math.floor(time / 1000) : 0,
      inbound: (tx.to ?? '').toLowerCase() === lower,
      // Transfers only lists executed value movements; failed transactions do not appear.
      status: 'success',
    });
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}

/** Native-value history (same scope as Blockscout txlist) from alchemy_getAssetTransfers, both directions. */
export async function fetchAlchemyActivity(
  owner: string,
  chainId: ChainId,
  key: string,
  limit = 25,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = TIMEOUT_MS,
): Promise<ActivityItem[]> {
  const url = `https://${ALCHEMY_NETWORK[chainId]}.g.alchemy.com/v2/${encodeURIComponent(key)}`;
  const call = (direction: 'fromAddress' | 'toAddress', id: number, signal?: AbortSignal) =>
    fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'alchemy_getAssetTransfers',
        params: [
          {
            fromBlock: '0x0',
            toBlock: 'latest',
            [direction]: owner,
            category: ['external'],
            withMetadata: true,
            excludeZeroValue: false,
            order: 'desc',
            maxCount: `0x${limit.toString(16)}`,
          },
        ],
      }),
    });
  return withTimeout(async (signal) => {
    const responses = await Promise.all([call('fromAddress', 1, signal), call('toAddress', 2, signal)]);
    const transfers: AlchemyTransfer[] = [];
    for (const response of responses) {
      if (!response.ok) {
        throw new Error(`Alchemy HTTP ${response.status}`);
      }
      const body = (await response.json()) as { result?: { transfers?: unknown }; error?: { message?: string } };
      if (body.error) {
        throw new Error(`Alchemy RPC ${body.error.message ?? 'error'}`);
      }
      if (Array.isArray(body.result?.transfers)) {
        transfers.push(...(body.result.transfers as AlchemyTransfer[]));
      }
    }
    return parseAlchemyTransfers(transfers, owner).slice(0, limit);
  }, timeoutMs);
}
