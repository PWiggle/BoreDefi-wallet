import { Contract, getAddress, isAddress, type TransactionResponse } from 'ethers';

import { logger } from '../logger';
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

export async function fetchNfts(owner: string, chainId: ChainId): Promise<NftItem[]> {
  const base = CHAINS[chainId].nftApi;
  if (!base) {
    return [];
  }
  const url = `${base}/addresses/${owner}/nft?type=ERC-721,ERC-1155`;
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = (await response.json()) as { items?: BlockscoutNft[] };
    return parseBlockscoutNfts(body.items ?? [], chainId);
  } catch (error) {
    logger.error('NFT list failed', {
      chainId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Could not load NFTs for this network.');
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
  const wallet = connectedWallet(input.mnemonic, input.item.chainId);
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
