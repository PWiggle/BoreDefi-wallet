import type { KeyValueStore } from './kv';
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
  { brand: 'uniswap', domains: ['uniswap.org', 'app.uniswap.org', 'uniswapfoundation.org', 'uniswap.foundation'] },
  { brand: 'yuga', domains: ['yuga.com', 'yugalabs.io'] },
  { brand: 'bayc', domains: ['boredapeyachtclub.com', 'bayc.com'] },
  { brand: 'boredape', domains: ['boredapeyachtclub.com'] },
  { brand: 'metamask', domains: ['metamask.io'] },
  { brand: 'phantom', domains: ['phantom.app', 'phantom.com'] },
  { brand: 'jupiter', domains: ['jup.ag'] },
  { brand: 'jup', domains: ['jup.ag'] },
  { brand: 'mevvy', domains: ['mevvy.app'] },
  { brand: 'boredefi', domains: ['boredefi.com'] },
  { brand: 'morpho', domains: ['morpho.org', 'app.morpho.org'] },
  { brand: 'apecoin', domains: ['apecoin.com'] },
];

const blocked = new Set<string>((seed as { blocklist: string[] }).blocklist);
const allowed = new Set<string>((seed as { allowlist: string[] }).allowlist);
for (const b of PROTECTED_BRANDS) for (const d of b.domains) allowed.add(d);

/**
 * Why a site was flagged. 'code-link' (javascript:, data:, file:) can never be opened; every other source shows a
 * warning the user can step past for this app session ("Continue anyway").
 */
export type PhishingSource = 'code-link' | 'blocklist' | 'phantom' | 'punycode' | 'lookalike' | 'goplus';

export type PhishingVerdict = {
  blocked: boolean;
  reason: string | null;
  source?: PhishingSource | null;
  /** False only for links that run code or open local files. */
  canContinue?: boolean;
  host?: string | null;
};

/** Phantom's open blocklist (MIT per its package.json). Off unless EXPO_PUBLIC_PHANTOM_BLOCKLIST=1; see README note. */
export const PHANTOM_BLOCKLIST_URL = 'https://raw.githubusercontent.com/phantom/blocklist/master/blocklist.yaml';
export const PHISHING_CACHE_PREFIX = 'boredefi.phish.v1.';
/** Refresh the public lists at most this often (they change daily; the bundled seed is the offline floor). */
export const PHISHING_REFRESH_MS = 12 * 60 * 60 * 1000;
const CHUNK_CHARS = 200_000;
const HASH_WIDTH = 10;

/** Domains from the refreshed MetaMask list that are not in the bundled seed, persisted as 48-bit hashes. */
const cachedHashes = new Set<string>();
const phantomBlocked = new Set<string>();
/** Hosts the user chose "Continue anyway" for, this app session only. */
const sessionAllowed = new Set<string>();

function fnv1a(value: string, offset: number): number {
  let h = offset >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Fixed-width 48-bit domain hash (persisted cache entry). Collisions are ~1 in 10^9 for the full list. */
export function domainHash(domain: string): string {
  const d = domain.toLowerCase();
  const hi = fnv1a(d, 0x811c9dc5);
  const lo = fnv1a(d, 0x050c5d1f) & 0xffff;
  return (hi * 0x10000 + lo).toString(36).padStart(HASH_WIDTH, '0');
}

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

type CacheMeta = { fetchedAt?: number; etag?: string | null; chunks?: number; allow?: string[]; phantomAt?: number };

async function readMeta(storage: KeyValueStore): Promise<CacheMeta> {
  try {
    const raw = await storage.getItem(`${PHISHING_CACHE_PREFIX}meta`);
    const parsed = raw ? (JSON.parse(raw) as CacheMeta) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let hydrated = false;

/** Loads the persisted list (hashes + phantom domains) into memory. Never throws. */
export async function hydratePhishingCache(storage: KeyValueStore): Promise<boolean> {
  try {
    const meta = await readMeta(storage);
    for (const d of meta.allow ?? []) if (typeof d === 'string') allowed.add(d.toLowerCase());
    const chunks = Math.min(Math.max(Number(meta.chunks) || 0, 0), 64);
    for (let i = 0; i < chunks; i += 1) {
      const chunk = await storage.getItem(`${PHISHING_CACHE_PREFIX}chunk.${i}`);
      if (!chunk) continue;
      for (let j = 0; j + HASH_WIDTH <= chunk.length; j += HASH_WIDTH) cachedHashes.add(chunk.slice(j, j + HASH_WIDTH));
    }
    const phantom = await storage.getItem(`${PHISHING_CACHE_PREFIX}phantom`);
    if (phantom) for (const d of phantom.split('\n')) if (d) phantomBlocked.add(d);
    hydrated = true;
    return true;
  } catch {
    return false;
  }
}

async function persistList(storage: KeyValueStore, domains: string[], meta: CacheMeta): Promise<void> {
  const seedSet = new Set((seed as { blocklist: string[] }).blocklist);
  const hashes = [...new Set(domains.filter((d) => !seedSet.has(d)).map(domainHash))].join('');
  const chunks = Math.ceil(hashes.length / CHUNK_CHARS);
  for (let i = 0; i < chunks; i += 1) {
    await storage.setItem(`${PHISHING_CACHE_PREFIX}chunk.${i}`, hashes.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS));
  }
  const old = await readMeta(storage);
  for (let i = chunks; i < (old.chunks ?? 0); i += 1) await storage.removeItem?.(`${PHISHING_CACHE_PREFIX}chunk.${i}`);
  await storage.setItem(`${PHISHING_CACHE_PREFIX}meta`, JSON.stringify({ ...old, ...meta, chunks }));
}

export type RefreshOptions = {
  /** Persist to / read freshness from this store (AsyncStorage on device). */
  storage?: KeyValueStore;
  now?: number;
  /** Skip the download when the cached copy is younger than this. Only applies with storage. */
  maxAgeMs?: number;
};

let inflight: Promise<boolean> | null = null;

/**
 * Updates the list from MetaMask's public file (eth-phishing-detect, DBAD license). Never throws; the bundled list
 * stays as a floor. With storage: loads the persisted copy, skips the download while it's fresh, sends
 * If-None-Match, and saves the new list as compact hashes so the next cold start is protected offline.
 */
export async function refreshPhishingList(fetchImpl: typeof fetch = fetch, options: RefreshOptions = {}): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    const { storage } = options;
    const now = options.now ?? Date.now();
    try {
      let meta: CacheMeta = {};
      if (storage) {
        if (!hydrated) await hydratePhishingCache(storage);
        meta = await readMeta(storage);
        if (meta.fetchedAt && now - meta.fetchedAt < (options.maxAgeMs ?? PHISHING_REFRESH_MS)) return true;
      }
      const headers: Record<string, string> = {};
      if (storage && meta.etag && (meta.chunks ?? 0) > 0) headers['If-None-Match'] = meta.etag;
      const res = await fetchImpl(PHISHING_LIST_URL, Object.keys(headers).length ? { headers } : undefined);
      if (res.status === 304 && storage) {
        await storage.setItem(`${PHISHING_CACHE_PREFIX}meta`, JSON.stringify({ ...meta, fetchedAt: now }));
        return true;
      }
      if (!res.ok) return false;
      const body = (await res.json()) as { blacklist?: unknown; whitelist?: unknown };
      const domains: string[] = [];
      const allow: string[] = [];
      if (Array.isArray(body.blacklist)) for (const d of body.blacklist) if (typeof d === 'string') domains.push(d.toLowerCase());
      if (Array.isArray(body.whitelist)) for (const d of body.whitelist) if (typeof d === 'string') allow.push(d.toLowerCase());
      for (const d of domains) blocked.add(d);
      for (const d of allow) allowed.add(d);
      if (storage) {
        let etag: string | null = null;
        try {
          etag = res.headers?.get?.('etag') ?? null;
        } catch {
          etag = null;
        }
        await persistList(storage, domains, { fetchedAt: now, etag, allow });
      }
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Pulls `- url: host` entries out of Phantom's blocklist.yaml (no YAML dependency needed for this flat file). */
export function parsePhantomBlocklist(yaml: string): string[] {
  const out = new Set<string>();
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^\s*-\s*url:\s*["']?([^"'\s#]+)["']?/i.exec(line);
    if (!m) continue;
    const host = hostOf(m[1]);
    if (host && host.includes('.') && !host.startsWith('*')) out.add(host);
  }
  return [...out];
}

/** Optional Solana-focused list from Phantom. Never throws. */
export async function refreshPhantomList(fetchImpl: typeof fetch = fetch, options: RefreshOptions = {}): Promise<boolean> {
  const { storage } = options;
  const now = options.now ?? Date.now();
  try {
    if (storage) {
      const meta = await readMeta(storage);
      if (meta.phantomAt && now - meta.phantomAt < (options.maxAgeMs ?? PHISHING_REFRESH_MS)) return true;
    }
    const res = await fetchImpl(PHANTOM_BLOCKLIST_URL);
    if (!res.ok) return false;
    const domains = parsePhantomBlocklist(await res.text());
    for (const d of domains) phantomBlocked.add(d);
    if (storage) {
      await storage.setItem(`${PHISHING_CACHE_PREFIX}phantom`, domains.join('\n'));
      const meta = await readMeta(storage);
      await storage.setItem(`${PHISHING_CACHE_PREFIX}meta`, JSON.stringify({ ...meta, phantomAt: now }));
    }
    return true;
  } catch {
    return false;
  }
}

function onBlocklist(host: string): boolean {
  return parentDomains(host).some((d) => blocked.has(d) || cachedHashes.has(domainHash(d)));
}

/** "Continue anyway" for this host until the app restarts. Code links can never be allowed. */
export function allowSiteForSession(raw: string | null | undefined): void {
  const host = raw ? hostOf(raw) : null;
  if (host) sessionAllowed.add(host);
}

export function isSiteAllowedForSession(raw: string | null | undefined): boolean {
  const host = raw ? hostOf(raw) : null;
  return Boolean(host && sessionAllowed.has(host));
}

/** On the official / allowlisted domains (no remote lookup needed). */
export function isKnownGoodSite(raw: string | null | undefined): boolean {
  const host = raw ? hostOf(raw) : null;
  return Boolean(host && isAllowed(host));
}

/** Test helper. */
export function resetPhishingSessionState(): void {
  sessionAllowed.clear();
}

/** checkPhishing, but a site the user already chose "Continue anyway" for this session is let through. */
export function checkSite(raw: string | null | undefined): PhishingVerdict {
  const verdict = checkPhishing(raw);
  if (verdict.blocked && verdict.canContinue && isSiteAllowedForSession(raw)) {
    return { blocked: false, reason: null, source: null, canContinue: true, host: verdict.host };
  }
  return verdict;
}

export function checkPhishing(raw: string | null | undefined): PhishingVerdict {
  const clean: PhishingVerdict = { blocked: false, reason: null, source: null, canContinue: true, host: null };
  if (!raw) return clean;
  const trimmed = raw.trim();
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return { blocked: true, reason: 'this link runs code or opens a local file.', source: 'code-link', canContinue: false, host: null };
  }
  const host = hostOf(trimmed);
  if (!host) return clean;
  const flag = (reason: string, source: PhishingSource): PhishingVerdict => ({ blocked: true, reason, source, canContinue: true, host });
  if (isAllowed(host)) return { ...clean, host };
  if (onBlocklist(host)) {
    return flag(`${host} is on the public phishing blocklist.`, 'blocklist');
  }
  if (parentDomains(host).some((d) => phantomBlocked.has(d))) {
    return flag(`${host} is on Phantom's public scam-site blocklist.`, 'phantom');
  }
  if (host.split('.').some((l) => l.startsWith('xn--')) || /[^\x00-\x7f]/.test(host)) {
    return flag(`${host} uses lookalike (punycode) letters.`, 'punycode');
  }
  const brand = lookalikeBrand(host);
  if (brand) {
    return flag(`${host} imitates ${brand} but is not its official site.`, 'lookalike');
  }
  return { ...clean, host };
}
