import { Contract, getAddress, isAddress, type TransactionResponse } from 'ethers';

import { logger } from '../logger';
import { alchemyEnabledFor, fetchAlchemyNfts, getAlchemyKey } from './alchemy';
import { CHAINS, type ChainId } from './chains';
import { connectedWallet, getProvider } from './rpc';

const ERC721_ABI = [
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
];

const ERC1155_ABI = [
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
];

export type NftStandard = 'ERC-721' | 'ERC-1155';

export type NftItem = {
  chainId: ChainId;
  contract: string;
  tokenId: string;
  standard: NftStandard;
  name: string;
  collection: string;
  imageUrl?: string;
};

type BlockscoutNft = {
  id?: string;
  token_id?: string;
  image_url?: string;
  metadata?: { name?: string; image?: string };
  token?: {
    type?: string;
    name?: string;
    address?: string;
    address_hash?: string;
  };
};

export function normalizeNftStandard(value: string | undefined): NftStandard | null {
  const upper = (value ?? '').toUpperCase();
  if (upper.includes('1155')) {
    return 'ERC-1155';
  }
  if (upper.includes('721')) {
    return 'ERC-721';
  }
  return null;
}

export function nftItemKey(item: Pick<NftItem, 'chainId' | 'contract' | 'tokenId'>): string {
  return `${item.chainId}:${item.contract.toLowerCase()}:${item.tokenId}`;
}

export function mergeNftLists(fetched: NftItem[], imported: NftItem[]): NftItem[] {
  const map = new Map<string, NftItem>();
  for (const item of imported) {
    map.set(nftItemKey(item), item);
  }
  for (const item of fetched) {
    map.set(nftItemKey(item), item);
  }
  return [...map.values()];
}

export function groupNftsByCollection<T extends { item: NftItem }>(entries: T[]): { collection: string; contract: string; entries: T[] }[] {
  const groups = new Map<string, { collection: string; contract: string; entries: T[] }>();
  for (const entry of entries) {
    const key = `${entry.item.chainId}:${entry.item.contract.toLowerCase()}`;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(key, {
        collection: entry.item.collection.trim() || 'Collection',
        contract: entry.item.contract,
        entries: [entry],
      });
    }
  }
  return [...groups.values()];
}

export function parseBlockscoutNfts(items: BlockscoutNft[], chainId: ChainId): NftItem[] {
  const parsed: NftItem[] = [];
  for (const item of items) {
    const standard = normalizeNftStandard(item.token?.type);
    const contract = item.token?.address_hash ?? item.token?.address;
    const tokenId = item.id ?? item.token_id;
    if (!standard || !contract || !isAddress(contract) || !tokenId) {
      continue;
    }
    parsed.push({
      chainId,
      contract: getAddress(contract),
      tokenId,
      standard,
      name: item.metadata?.name ?? `#${tokenId}`,
      collection: item.token?.name ?? 'NFT',
      imageUrl: item.image_url ?? item.metadata?.image,
    });
  }
  return parsed;
}

/**
 * Autodetect outcome for one network.
 * - `ok`: the catalog answered. An empty list (or a 404 for an address it has never seen)
 *   just means the wallet holds no NFTs there.
 * - `unavailable`: the catalog could not be reached or refused the request (for example the
 *   Cloudflare 403 challenge Blockscout now serves to app clients on Base, Polygon and Arbitrum,
 *   402 Pro API, 429, 5xx, a timeout or a non-JSON body). We cannot say the wallet is empty, but
 *   this is not a wallet error either, so the screen shows a quiet note instead of a red banner.
 */
export type NftAutodetect = 'ok' | 'unavailable';

export type NftFetchResult = { items: NftItem[]; autodetect: NftAutodetect };

export const NFT_FETCH_TIMEOUT_MS = 15_000;

export function classifyNftHttpStatus(status: number): 'json' | 'empty' | 'unavailable' {
  if (status >= 200 && status < 300) {
    return 'json';
  }
  if (status === 404) {
    return 'empty';
  }
  return 'unavailable';
}

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export async function fetchNfts(
  owner: string,
  chainId: ChainId,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs: number = NFT_FETCH_TIMEOUT_MS,
  alchemyKey: string | null = getAlchemyKey(),
): Promise<NftFetchResult> {
  if (alchemyKey && alchemyEnabledFor(chainId, alchemyKey)) {
    const viaAlchemy = await fetchAlchemyNfts(owner, chainId, alchemyKey, fetchImpl, timeoutMs);
    if (viaAlchemy.autodetect === 'ok') {
      return viaAlchemy;
    }
    // Fall through to Blockscout.
  }
  return fetchBlockscoutNfts(owner, chainId, fetchImpl, timeoutMs);
}

export async function fetchBlockscoutNfts(
  owner: string,
  chainId: ChainId,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs: number = NFT_FETCH_TIMEOUT_MS,
): Promise<NftFetchResult> {
  const base = CHAINS[chainId].nftApi;
  if (!base) {
    return { items: [], autodetect: 'ok' };
  }
  const url = `${base}/addresses/${owner}/nft?type=ERC-721,ERC-1155`;
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    const kind = classifyNftHttpStatus(response.status);
    if (kind === 'empty') {
      return { items: [], autodetect: 'ok' };
    }
    if (kind === 'unavailable') {
      logger.warn('NFT autodetect unavailable', { chainId, status: response.status });
      return { items: [], autodetect: 'unavailable' };
    }
    const body = (await response.json()) as { items?: unknown } | null;
    const items = Array.isArray(body?.items) ? (body.items as BlockscoutNft[]) : [];
    return { items: parseBlockscoutNfts(items, chainId), autodetect: 'ok' };
  } catch (error) {
    logger.warn('NFT autodetect unavailable', {
      chainId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    return { items: [], autodetect: 'unavailable' };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function verifyNftOwnership(
  owner: string,
  item: NftItem,
  amount: bigint = 1n,
): Promise<void> {
  const provider = getProvider(item.chainId);
  const ownerAddress = getAddress(owner);
  if (item.standard === 'ERC-721') {
    const nft = new Contract(item.contract, ERC721_ABI, provider);
    const current = getAddress(await nft.ownerOf(BigInt(item.tokenId)));
    if (current !== ownerAddress) {
      throw new Error('This wallet is not the on-chain owner of that NFT. Send blocked.');
    }
    return;
  }
  const nft = new Contract(item.contract, ERC1155_ABI, provider);
  const balance = (await nft.balanceOf(ownerAddress, BigInt(item.tokenId))) as bigint;
  if (balance < amount) {
    throw new Error('This wallet does not hold that ERC-1155 amount. Send blocked.');
  }
}

export async function sendNft(input: {
  mnemonic: string;
  owner: string;
  to: string;
  item: NftItem;
  amount?: bigint;
}): Promise<TransactionResponse> {
  const to = getAddress(input.to);
  await verifyNftOwnership(input.owner, input.item, input.amount ?? 1n);
  const wallet = await connectedWallet(input.mnemonic, input.item.chainId);
  logger.info('NFT send', {
    chainId: input.item.chainId,
    standard: input.item.standard,
    contract: input.item.contract,
  });
  if (input.item.standard === 'ERC-721') {
    const nft = new Contract(input.item.contract, ERC721_ABI, wallet);
    return nft.safeTransferFrom(input.owner, to, BigInt(input.item.tokenId)) as Promise<TransactionResponse>;
  }
  const nft = new Contract(input.item.contract, ERC1155_ABI, wallet);
  return nft.safeTransferFrom(
    input.owner,
    to,
    BigInt(input.item.tokenId),
    input.amount ?? 1n,
    '0x',
  ) as Promise<TransactionResponse>;
}
