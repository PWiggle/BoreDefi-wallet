import seed from './phishing-seed.json';

/**
 * In-app browser phishing protection. $0: a bundled brand-related subset of MetaMask's eth-phishing-detect list
 * (DBAD license), optionally refreshed at runtime from the same public file (kept in memory only), plus lookalike /
 * punycode detection for protected brands. A blocked site never gets the wallet connected.
 */
export const PHISHING_LIST_URL = 'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json';

/** Official domains for brands we protect. Any other host that imitates one of these is treated as phishing. */
export const PROTECTED_BRANDS: { brand: string; domains: string[] }[] = [
  { brand: 'opensea', domains: ['opensea.io'] },
  { brand: 'uniswap', domains: ['uniswap.org', 'app.uniswap.org'] },
  { brand: 'yuga', domains: ['yuga.com', 'yugalabs.io'] },
  { brand: 'bayc', domains: ['boredapeyachtclub.com', 'bayc.com'] },
  { brand: 'boredape', domains: ['boredapeyachtclub.com'] },
  { brand: 'metamask', domains: ['metamask.io'] },
  { brand: 'phantom', domains: ['phantom.app', 'phantom.com'] },
  { brand: 'jupiter', domains: ['jup.ag'] },
  { brand: 'jup', domains: ['jup.ag'] },
  { brand: 'mevvy', domains: ['mevvy.app'] },
  { brand: 'boredefi', domains: ['boredefi.com'] },
  { brand: 'apecoin', domains: ['apecoin.com'] },
];

const blocked = new Set<string>((seed as { blocklist: string[] }).blocklist);
const allowed = new Set<string>((seed as { allowlist: string[] }).allowlist);
for (const b of PROTECTED_BRANDS) for (const d of b.domains) allowed.add(d);

export type PhishingVerdict = { blocked: boolean; reason: string | null };

export function hostOf(raw: string): string | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    return url.hostname.toLowerCase().replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

function parentDomains(host: string): string[] {
  const parts = host.split('.');
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i += 1) out.push(parts.slice(i).join('.'));
  return out;
}

function isAllowed(host: string): boolean {
  return parentDomains(host).some((d) => allowed.has(d));
}

/** Confusable characters that make a brand look right (0→o, 1→l, rn→m, vv→w). */
function skeleton(value: string): string {
  return value
    .toLowerCase()
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/[0]/g, 'o')
    .replace(/[1|!]/g, 'l')
    .replace(/[3]/g, 'e')
    .replace(/[5]/g, 's')
    .replace(/[@4]/g, 'a')
    .replace(/[^a-z]/g, '');
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function lookalikeBrand(host: string): string | null {
  if (isAllowed(host)) return null;
  const labels = host.split('.');
  const registrable = labels.slice(-2).join('.');
  const words = labels.join('-').split(/[-.]/).filter(Boolean);
  for (const { brand } of PROTECTED_BRANDS) {
    if (brand.length < 4) continue; // 'jup' / 'bayc' only via exact label
    for (const word of words) {
      const sk = skeleton(word);
      if (sk.includes(skeleton(brand))) return brand;
      if (brand.length >= 6 && Math.abs(sk.length - brand.length) <= 1 && editDistance(sk, brand) === 1) return brand;
    }
  }
  for (const short of ['jup', 'bayc']) {
    if (words.includes(short) && !isAllowed(host)) return short;
  }
  void registrable;
  return null;
}

/** Updates the in-memory list from MetaMask's public file. Never throws; the bundled list stays as a floor. */
export async function refreshPhishingList(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(PHISHING_LIST_URL);
    if (!res.ok) return false;
    const body = (await res.json()) as { blacklist?: unknown; whitelist?: unknown };
    if (Array.isArray(body.blacklist)) for (const d of body.blacklist) if (typeof d === 'string') blocked.add(d.toLowerCase());
    if (Array.isArray(body.whitelist)) for (const d of body.whitelist) if (typeof d === 'string') allowed.add(d.toLowerCase());
    return true;
  } catch {
    return false;
  }
}

export function checkPhishing(raw: string | null | undefined): PhishingVerdict {
  if (!raw) return { blocked: false, reason: null };
  const trimmed = raw.trim();
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return { blocked: true, reason: 'This link runs code or opens a local file. Blocked.' };
  }
  const host = hostOf(trimmed);
  if (!host) return { blocked: false, reason: null };
  if (isAllowed(host)) return { blocked: false, reason: null };
  if (parentDomains(host).some((d) => blocked.has(d))) {
    return { blocked: true, reason: `${host} is on the public phishing blocklist.` };
  }
  if (host.split('.').some((l) => l.startsWith('xn--')) || /[^\x00-\x7f]/.test(host)) {
    return { blocked: true, reason: `${host} uses lookalike (punycode) letters. Blocked to protect your wallet.` };
  }
  const brand = lookalikeBrand(host);
  if (brand) {
    return { blocked: true, reason: `${host} imitates ${brand} but is not its official site. Blocked.` };
  }
  return { blocked: false, reason: null };
}
