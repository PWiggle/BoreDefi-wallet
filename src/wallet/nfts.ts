import { Contract, getAddress, isAddress, type TransactionResponse } from 'ethers';

import { logger } from '../logger';
import { CHAINS, type ChainId } from './chains';
import { connectedWallet } from './rpc';

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

export async function sendNft(input: {
  mnemonic: string;
  owner: string;
  to: string;
  item: NftItem;
  amount?: bigint;
}): Promise<TransactionResponse> {
  const to = getAddress(input.to);
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
