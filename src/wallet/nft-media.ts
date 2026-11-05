/**
 * Gateways tried in order; SafeNftImage moves to the next one when an image fails to load.
 * DO NOT put ipfs.io first: since Nov 2026 it answers 429 "switching to a service worker gateway" text instead of
 * the image (BAYC, Lil Mutants), which left every IPFS NFT on the plain "NFT" tile in 1.0.4.
 * Checked 2026-11-04: filebase and pinata return image/png 200 for Lil Mutants #4632 and BAYC #0.
 */
export const IPFS_GATEWAYS = [
  'https://ipfs.filebase.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
] as const;
const IPFS_GATEWAY = IPFS_GATEWAYS[0];

function stripQuery(pathname: string): string {
  return pathname.split('?')[0] ?? pathname;
}

export function isSvgDocumentUrl(url: URL): boolean {
  const path = stripQuery(url.pathname).toLowerCase();
  return path.endsWith('.svg') || path.endsWith('.svgz') || path.includes('.svg/');
}

export function safeNftImageUrl(raw?: string | null): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (/^(javascript|data|blob|file|http):/i.test(trimmed)) {
    return null;
  }

  if (/^ipfs:\/\//i.test(trimmed)) {
    const path = trimmed.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '');
    if (!path || path.toLowerCase().endsWith('.svg')) {
      return null;
    }
    return `${IPFS_GATEWAY}${path}`;
  }

  if (/^ipfs\//i.test(trimmed)) {
    const path = trimmed.slice(5);
    if (!path || path.toLowerCase().endsWith('.svg')) {
      return null;
    }
    return `${IPFS_GATEWAY}${path}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') {
    return null;
  }
  if (isSvgDocumentUrl(parsed)) {
    return null;
  }
  return parsed.href;
}

const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_BASE32 = /^b[a-z2-7]{58,}$/;

/** True for a well-formed IPFS CID (v0 base58 "Qm…" or v1 base32 "b…"). */
export function isIpfsCid(value: string): boolean {
  return CID_V0.test(value) || CID_V1_BASE32.test(value);
}

/**
 * Extract "<cid>/<path>" from ipfs://, /ipfs/ paths on any gateway, or subdomain gateways (<cid>.ipfs.host).
 * Returns null when the URL is not content-addressed.
 */
export function ipfsContentPath(raw?: string | null): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  let rest: string | null = null;
  if (/^ipfs:\/\//i.test(trimmed)) {
    rest = trimmed.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '');
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:') {
      return null;
    }
    const pathMatch = parsed.pathname.match(/^\/ipfs\/(.+)$/);
    if (pathMatch?.[1]) {
      rest = decodeURIComponent(pathMatch[1]);
    } else {
      const sub = parsed.hostname.match(/^([a-z0-9]+)\.ipfs\./i);
      if (sub?.[1]) {
        rest = `${sub[1]}${decodeURIComponent(parsed.pathname)}`.replace(/\/$/, '');
      }
    }
  }
  if (!rest) {
    return null;
  }
  const clean = rest.split('?')[0]?.split('#')[0] ?? '';
  const [cid, ...path] = clean.split('/');
  if (!cid || !isIpfsCid(cid)) {
    return null;
  }
  if (path.some((part) => part === '..' || part === '.')) {
    return null;
  }
  const joined = [cid, ...path.filter(Boolean)].join('/');
  if (joined.toLowerCase().endsWith('.svg') || joined.toLowerCase().endsWith('.svgz')) {
    return null;
  }
  return joined;
}

/**
 * Image for a protected (Yuga / BAYC) NFT. Only content-addressed IPFS images are shown, and always
 * through the wallet's own gateway, so a metadata server or CDN cannot swap in an image with
 * misleading text. Anything else returns null and the tile shows the verified name instead.
 */
export function protectedNftImageUrl(item: { imageOriginal?: string; imageUrl?: string }): string | null {
  const path = ipfsContentPath(item.imageOriginal) ?? ipfsContentPath(item.imageUrl);
  return path ? `${IPFS_GATEWAY}${path}` : null;
}

/** IPFS path behind an ipfs:// / ipfs/ value, or any https gateway URL that is content-addressed. */
function ipfsPathOf(raw: string): string | null {
  const content = ipfsContentPath(raw);
  if (content) {
    return content;
  }
  const trimmed = raw.trim();
  if (/^ipfs:\/\//i.test(trimmed)) {
    return trimmed.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '') || null;
  }
  if (/^ipfs\//i.test(trimmed)) {
    return trimmed.slice(5) || null;
  }
  return null;
}

/**
 * Every URL SafeNftImage may try for one image, best first. IPFS images go through each of our gateways in order
 * (and a non-protected https gateway URL from the metadata is kept last). Anything safeNftImageUrl rejects
 * (http, data:, javascript:, SVG) gives an empty list. A protected image reaches here already rewritten to
 * IPFS_GATEWAYS[0], so its candidates stay on our gateways and the content-addressed path.
 */
export function nftImageCandidates(raw?: string | null): string[] {
  const safe = safeNftImageUrl(raw);
  if (!safe || !raw) {
    return [];
  }
  const path = ipfsPathOf(raw);
  if (!path) {
    return [safe];
  }
  const urls: string[] = IPFS_GATEWAYS.map((gateway) => `${gateway}${path}`);
  if (!urls.includes(safe)) {
    urls.push(safe);
  }
  return urls;
}
