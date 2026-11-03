import { getAddress, isAddress } from 'ethers';

import { safeNftImageUrl } from './nft-media';
import { type NftItem } from './nfts';
import {
  FAKE_LABEL,
  protectedAssetFor,
  protectedBadgeLabel,
  yugaLookalikeMatch,
  type ProtectedAsset,
} from './yuga-allowlist';

type FamousCollection = {
  aliases: string[];
  contracts: string[];
};

/**
 * Other famous (non-Yuga) collections. Every Yuga Labs / BAYC contract lives in yuga-allowlist.ts and is
 * matched by address there, with a stricter lookalike check.
 */
export const FAMOUS: FamousCollection[] = [
  {
    aliases: ['azuki'],
    contracts: ['0xED5AF388653567Af2F388E6224dC7C4b3241C544'],
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
  /** Official Yuga Labs / BAYC contract (badge comes only from chain + address). */
  verified: boolean;
  /** Name looks like a Yuga / BAYC brand but the contract is not on the allowlist. */
  fake: boolean;
  /** Short label for the tile / sheet: 'Verified', 'Fake: not the official contract', or null. */
  label: string | null;
  protectedAsset: ProtectedAsset | null;
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

export function famousMatch(name: string, collection: string, contract: string, chainId = 1): {
  impersonation: boolean;
  canonical: boolean;
} {
  if (protectedAssetFor(chainId, contract)) {
    return { impersonation: false, canonical: true };
  }
  if (yugaLookalikeMatch(name, collection)) {
    return { impersonation: true, canonical: false };
  }
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
  const asset = protectedAssetFor(item.chainId, item.contract);
  if (asset && asset.standard !== 'ERC-20') {
    // Verified by address. Never hidden as spam, whatever the metadata says.
    return {
      hidden: false,
      reasons: [],
      impersonation: false,
      canonical: true,
      verified: true,
      fake: false,
      label: protectedBadgeLabel(asset),
      protectedAsset: asset,
    };
  }

  const reasons: string[] = [];
  const image = safeNftImageUrl(item.imageUrl);
  const collection = item.collection.trim() || 'NFT';
  const yugaFake = yugaLookalikeMatch(item.name, item.collection);
  const fame = yugaFake ? { impersonation: true, canonical: false } : famousMatch(item.name, collection, item.contract);

  if (yugaFake) {
    reasons.push(`${FAKE_LABEL}. Its name looks like a protected collection (Yuga Labs / Bored Ape / Yaper Lil Apes), but this contract is not on the verified list.`);
  } else if (fame.impersonation) {
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
  // A Yuga lookalike stays hidden even after "Show anyway" was tapped before this check existed.
  const hidden = yugaFake ? true : reasons.length > 0 && !revealed.has(key);
  return {
    hidden,
    reasons,
    impersonation: fame.impersonation,
    canonical: fame.canonical,
    verified: false,
    fake: Boolean(yugaFake),
    label: yugaFake ? FAKE_LABEL : null,
    protectedAsset: null,
  };
}

/**
 * The name to show. For a protected collection it is always the verified name plus the token id;
 * tokenURI / marketplace metadata names are never shown over it.
 */
export function displayNftName(item: Pick<NftItem, 'chainId' | 'contract' | 'tokenId' | 'name'>): string {
  const asset = protectedAssetFor(item.chainId, item.contract);
  if (asset && asset.standard !== 'ERC-20') {
    return `${asset.name} #${item.tokenId}`;
  }
  return item.name;
}

export function displayCollectionName(item: Pick<NftItem, 'chainId' | 'contract' | 'collection'>): string {
  const asset = protectedAssetFor(item.chainId, item.contract);
  if (asset && asset.standard !== 'ERC-20') {
    return asset.name;
  }
  return item.collection.trim() || 'Collection';
}
