import { classifyNftSpam, nftStorageKey, type NftSpamAssessment } from './nft-spam';
import type { NftFetchResult, NftItem } from './nfts';
import { protectedAssetFor } from './yuga-allowlist';

export type NftGalleryEntry = { item: NftItem; risk: NftSpamAssessment & { hiddenByYou?: boolean } };

/**
 * Builds the NFT tab list. An owned NFT on a verified (protected) contract is never hidden by the spam filter; a manual
 * Hide only moves it to the labeled Hidden section (still listed, one-tap Show) (Lil Mutants #4632, iOS build 16, Nov 4 2026).
 * Every item in `items` comes back exactly once; nothing is dropped.
 */
export function buildNftGallery(
  items: NftItem[],
  revealed: ReadonlySet<string>,
  userHidden: ReadonlySet<string>,
): NftGalleryEntry[] {
  return items.map((item) => {
    const risk = classifyNftSpam(item, revealed);
    const isProtected = Boolean(protectedAssetFor(item.chainId, item.contract));
    const byYou = userHidden.has(nftStorageKey(item));
    // Protected: never hidden by spam rules. A manual Hide moves it to the labeled Hidden section (one-tap Show).
    const hidden = isProtected ? byYou : byYou || risk.hidden;
    const reasons = isProtected && byYou ? ['Hidden by you. Verified collection: tap Show to put it back.'] : risk.reasons;
    return { item, risk: { ...risk, hidden, reasons, hiddenByYou: byYou } };
  });
}

/**
 * When the catalog is unreachable (timeout, 403/429/5xx), keep the last list that loaded for this wallet and
 * network instead of showing an empty tab. A fresh `ok` answer always wins.
 */
export function reconcileNftFetch(result: NftFetchResult, lastGood: NftItem[] | null): NftFetchResult & { fromCache: boolean } {
  if (result.autodetect === 'ok') {
    return { ...result, fromCache: false };
  }
  const cached = (lastGood ?? []).filter((item) => item && typeof item.contract === 'string' && typeof item.tokenId === 'string');
  return { items: cached.length > 0 ? cached : result.items, autodetect: 'unavailable', fromCache: cached.length > 0 };
}
