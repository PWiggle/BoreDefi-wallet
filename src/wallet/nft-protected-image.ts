import { Contract, type AbstractProvider } from 'ethers';

import { logger } from '../logger';
import type { ChainId } from './chains';
import { IPFS_GATEWAYS, ipfsContentPath, protectedNftImageUrl } from './nft-media';
import type { NftItem } from './nfts';
import { readWithFallback } from './rpc';

/**
 * Image for a protected NFT when the indexer only gave a CDN copy.
 *
 * WHY (iOS build 15 / Android vc31, Nov 4 2026): with EXPO_PUBLIC_ALCHEMY_KEY set, NFTs come from Alchemy. For Lil
 * Mutants #4632 Alchemy returns raw.metadata.image = null, image.originalUrl = i2c.seadn.io (OpenSea CDN) and
 * cachedUrl = nft2-cdn.alchemy.com. Neither is content-addressed, so protectedNftImageUrl() correctly refused them and
 * the tile showed the plain "NFT" placeholder, even though the gateway failover worked.
 *
 * The protection rule stays: we only ever show an image addressed by IPFS content hash, through our own gateways.
 * We get that hash from the token itself: tokenURI (from the indexer, else a read-only on-chain call) must be
 * content-addressed, its JSON is read through our gateways, and its "image" must be content-addressed too.
 */

const METADATA_TIMEOUT_MS = 10_000;
const MAX_METADATA_BYTES = 256 * 1024;

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export type TokenUriReader = (item: Pick<NftItem, 'chainId' | 'contract' | 'tokenId' | 'standard'>) => Promise<string | null>;

const ERC721_URI_ABI = ['function tokenURI(uint256 tokenId) view returns (string)'];
const ERC1155_URI_ABI = ['function uri(uint256 id) view returns (string)'];

/** ERC-1155 "{id}" substitution: lowercase hex, zero-padded to 64 chars. */
export function expandErc1155Uri(uri: string, tokenId: string): string {
  if (!uri.includes('{id}')) {
    return uri;
  }
  const hex = BigInt(tokenId).toString(16).padStart(64, '0');
  return uri.split('{id}').join(hex);
}

/** Read-only eth_call: tokenURI(id) for ERC-721, uri(id) for ERC-1155. */
export const readTokenUriOnChain: TokenUriReader = async (item) => {
  const is1155 = item.standard === 'ERC-1155';
  const raw = await readWithFallback(item.chainId as ChainId, async (provider: AbstractProvider) => {
    const contract = new Contract(item.contract, is1155 ? ERC1155_URI_ABI : ERC721_URI_ABI, provider);
    const fn = contract.getFunction(is1155 ? 'uri' : 'tokenURI');
    return (await fn.staticCall(BigInt(item.tokenId))) as string;
  });
  if (!raw) {
    return null;
  }
  return is1155 ? expandErc1155Uri(raw, item.tokenId) : raw;
};

/** 'image' (or 'image_url') from metadata JSON, or undefined. */
function imageField(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const value = record.image ?? record.image_url;
  return typeof value === 'string' ? value : undefined;
}

type MetadataResult = { kind: 'ok'; image: string | undefined } | { kind: 'unavailable' };

/** Fetch content-addressed metadata JSON through our gateways, in order; a gateway that errors or is not JSON is skipped. */
async function fetchIpfsMetadata(path: string, fetchImpl: FetchLike, timeoutMs: number): Promise<MetadataResult> {
  for (const gateway of IPFS_GATEWAYS) {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(`${gateway}${path}`, {
        headers: { Accept: 'application/json' },
        signal: controller?.signal,
      });
      if (!response.ok) {
        continue;
      }
      const text = await response.text();
      if (text.length > MAX_METADATA_BYTES) {
        continue;
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        // e.g. ipfs.io's 2026 "switching to a service worker gateway" text page.
        continue;
      }
      return { kind: 'ok', image: imageField(body) };
    } catch {
      continue;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  return { kind: 'unavailable' };
}

export type ResolveDeps = {
  fetchImpl?: FetchLike;
  readTokenUri?: TokenUriReader;
  timeoutMs?: number;
};

/**
 * Content-addressed image URL (on IPFS_GATEWAYS[0]) for a protected NFT, or null when the token has none.
 * Throws only for transient failures (RPC / every gateway down) so callers can retry later instead of caching null.
 */
export async function resolveProtectedNftImage(
  item: Pick<NftItem, 'chainId' | 'contract' | 'tokenId' | 'standard' | 'imageOriginal' | 'imageUrl' | 'tokenUri'>,
  deps: ResolveDeps = {},
): Promise<string | null> {
  const direct = protectedNftImageUrl(item);
  if (direct) {
    return direct;
  }
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const readTokenUri = deps.readTokenUri ?? readTokenUriOnChain;
  const timeoutMs = deps.timeoutMs ?? METADATA_TIMEOUT_MS;

  let metaPath = ipfsContentPath(item.tokenUri);
  if (!metaPath) {
    const onChain = await readTokenUri(item);
    metaPath = ipfsContentPath(onChain);
  }
  if (!metaPath) {
    // tokenURI is an https API or data: URI: its image could change, so a protected tile keeps the verified name.
    return null;
  }
  const metadata = await fetchIpfsMetadata(metaPath, fetchImpl, timeoutMs);
  if (metadata.kind === 'unavailable') {
    throw new Error('IPFS metadata unavailable on every gateway.');
  }
  return protectedNftImageUrl({ imageOriginal: metadata.image });
}

const resolved = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function cacheKey(item: Pick<NftItem, 'chainId' | 'contract' | 'tokenId'>): string {
  return `${item.chainId}:${item.contract.toLowerCase()}:${item.tokenId}`;
}

/** Synchronous cache read (undefined = not resolved yet). */
export function cachedProtectedNftImage(item: Pick<NftItem, 'chainId' | 'contract' | 'tokenId'>): string | null | undefined {
  const key = cacheKey(item);
  return resolved.has(key) ? (resolved.get(key) ?? null) : undefined;
}

/**
 * Memoized resolveProtectedNftImage. Definite answers (an image, or "this token has no content-addressed image") are
 * cached for the session; transient failures are not, so reopening the NFT tries again.
 */
export function resolveProtectedNftImageCached(
  item: Parameters<typeof resolveProtectedNftImage>[0],
  deps: ResolveDeps = {},
): Promise<string | null> {
  const key = cacheKey(item);
  if (resolved.has(key)) {
    return Promise.resolve(resolved.get(key) ?? null);
  }
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const promise = resolveProtectedNftImage(item, deps)
    .then((url) => {
      resolved.set(key, url);
      return url;
    })
    .catch((error: unknown) => {
      logger.warn('Protected NFT image not resolved', {
        chainId: item.chainId,
        message: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

/** Test hook. */
export function clearProtectedNftImageCache(): void {
  resolved.clear();
  inflight.clear();
}
