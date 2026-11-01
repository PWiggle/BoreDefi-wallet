import { getAddress, isAddress } from 'ethers';

import { safeNftImageUrl } from './nft-media';
import { type NftItem } from './nfts';

type FamousCollection = {
  aliases: string[];
  contracts: string[];
};

const FAMOUS: FamousCollection[] = [
  {
    aliases: ['bored ape', 'bored ape yacht', 'bayc', 'boredapeyachtclub'],
    contracts: ['0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'],
  },
  {
    aliases: ['mutant ape', 'mayc', 'mutantape'],
    contracts: ['0x60E4d786628Fea6478F785A6d7e704777c86A7c6'],
  },
  {
    aliases: ['azuki'],
    contracts: ['0xED5AF388Ae54bC31Dd3Df730d16179AD4aC56170'],
  },
  {
    aliases: ['pudgy penguin', 'pudgy penguins', 'pudgy'],
    contracts: ['0xBd3531dA5CF5857e7CfAA92426877b022e612cf8'],
  },
  {
    aliases: ['lil pudgy', 'lil pudgys'],
    contracts: ['0x524cAB2ec69124574082676e6F654a18df49A048'],
  },
  {
    aliases: ['cryptopunk', 'crypto punk', 'cryptopunks'],
    contracts: ['0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB'],
  },
  {
    aliases: ['doodles', 'doodle'],
    contracts: ['0x8a90CAb2b38dba80c64b7734e58Ee1dB38B8992e'],
  },
  {
    aliases: ['moonbirds', 'moonbird'],
    contracts: ['0x23581767a106ae21c074b2276D25e5C3e136a68b'],
  },
  {
    aliases: ['clonex', 'clone x'],
    contracts: ['0x49cF6f5d44E70224e2E23fDcdd2C053F30aDA28B'],
  },
  {
    aliases: ['cool cats', 'cool cat'],
    contracts: ['0x1A92f7381B9F03921564a437210bB9396471050C'],
  },
];

const GENERIC_COLLECTION = /^(nft|nfts|unknown|token|collection|item|airdrop)$/i;

export type NftSpamAssessment = {
  hidden: boolean;
  reasons: string[];
  impersonation: boolean;
  canonical: boolean;
};

export function nftStorageKey(item: Pick<NftItem, 'chainId' | 'contract' | 'tokenId'>): string {
  return `${item.chainId}:${item.contract.toLowerCase()}:${item.tokenId}`;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function checksumSet(addresses: string[]): Set<string> {
  return new Set(
    addresses.filter((item) => isAddress(item)).map((item) => getAddress(item)),
  );
}

export function famousMatch(name: string, collection: string, contract: string): {
  impersonation: boolean;
  canonical: boolean;
} {
  const haystack = `${normalizeName(name)} ${normalizeName(collection)}`;
  const checksum = isAddress(contract) ? getAddress(contract) : contract;
  for (const famous of FAMOUS) {
    const hit = famous.aliases.some((alias) => haystack.includes(alias));
    if (!hit) {
      continue;
    }
    const allowed = checksumSet(famous.contracts);
    if (allowed.has(checksum)) {
      return { impersonation: false, canonical: true };
    }
    return { impersonation: true, canonical: false };
  }
  return { impersonation: false, canonical: false };
}

export function classifyNftSpam(item: NftItem, revealed: ReadonlySet<string>): NftSpamAssessment {
  const reasons: string[] = [];
  const image = safeNftImageUrl(item.imageUrl);
  const collection = item.collection.trim() || 'NFT';
  const fame = famousMatch(item.name, collection, item.contract);

  if (fame.impersonation) {
    reasons.push('Name looks like a famous collection, but the contract is not the canonical one.');
  }
  if (!image) {
    reasons.push('No safe https image. Drainbait airdrops often ship without media.');
  }
  if (GENERIC_COLLECTION.test(collection) || isAddress(collection)) {
    reasons.push('Unknown or generic collection name.');
  } else if (!fame.canonical) {
    reasons.push('Unknown collection — treated as an unsolicited airdrop until you show it.');
  }

  const key = nftStorageKey(item);
  const hidden = reasons.length > 0 && !revealed.has(key);
  return {
    hidden,
    reasons,
    impersonation: fame.impersonation,
    canonical: fame.canonical,
  };
}
