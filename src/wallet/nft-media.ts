const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

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
