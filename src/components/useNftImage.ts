import { useEffect, useState } from 'react';

import { protectedNftImageUrl } from '../wallet/nft-media';
import { cachedProtectedNftImage, resolveProtectedNftImageCached } from '../wallet/nft-protected-image';
import type { NftItem } from '../wallet/nfts';
import { protectedAssetFor } from '../wallet/yuga-allowlist';

/**
 * Image URL for one NFT tile / detail hero.
 * Protected collections only show content-addressed IPFS images. When the indexer gave only a CDN copy (Alchemy for
 * Lil Mutants), the IPFS image is resolved from the token's own tokenURI metadata; until then `resolving` is true.
 */
export function useNftImage(item: NftItem | null | undefined): { url: string | undefined; resolving: boolean } {
  const isProtected = item ? Boolean(protectedAssetFor(item.chainId, item.contract)) : false;
  const direct = item ? (isProtected ? protectedNftImageUrl(item) ?? undefined : item.imageUrl) : undefined;
  const needsResolve = Boolean(item && isProtected && !direct);
  const cached = item && needsResolve ? cachedProtectedNftImage(item) : undefined;
  const [resolved, setResolved] = useState<{ key: string; url: string | null } | null>(null);
  const key = item ? `${item.chainId}:${item.contract.toLowerCase()}:${item.tokenId}` : '';

  useEffect(() => {
    if (!item || !needsResolve || cached !== undefined) {
      return;
    }
    let alive = true;
    void resolveProtectedNftImageCached(item).then((url) => {
      if (alive) {
        setResolved({ key, url });
      }
    });
    return () => {
      alive = false;
    };
    // item identity changes on every refresh; the key is what matters.
  }, [key, needsResolve, cached]);

  if (!item) {
    return { url: undefined, resolving: false };
  }
  if (!needsResolve) {
    return { url: direct, resolving: false };
  }
  if (cached !== undefined) {
    return { url: cached ?? undefined, resolving: false };
  }
  if (resolved && resolved.key === key) {
    return { url: resolved.url ?? undefined, resolving: false };
  }
  return { url: undefined, resolving: true };
}
