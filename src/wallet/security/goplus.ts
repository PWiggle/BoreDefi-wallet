/**
 * GoPlus Security API (https://docs.gopluslabs.io), free tier, no key required for the endpoints used here.
 * Optional EXPO_PUBLIC_GOPLUS_ACCESS_TOKEN is sent as a Bearer token if set (higher limits); it ships in the
 * app bundle, so only ever put a GoPlus *access token* there, never an app secret.
 *
 * Every call is cached, de-duplicated, rate limited below the free tier (30 calls/min, 30k/day) and fails open:
 * a timeout, rate limit or unknown answer returns null (unknown) and never blocks the wallet.
 */

export const GOPLUS_BASE_URL = 'https://api.gopluslabs.io/api/v1';

/** EVM chains BoreDefi supports that GoPlus covers. ApeChain (33139) is not covered: always "unknown". */
export const GOPLUS_EVM_CHAINS: ReadonlySet<number> = new Set([1, 10, 56, 137, 8453, 42161, 43114]);

export type RiskLevel = 'trusted' | 'ok' | 'warn' | 'danger';

export type RiskReport = {
  level: RiskLevel;
  /** Plain-words reasons, most serious first. Empty for trusted / ok. */
  reasons: string[];
};

const OK: RiskReport = { level: 'ok', reasons: [] };
const TRUSTED: RiskReport = { level: 'trusted', reasons: [] };

function flag(value: unknown): boolean {
  return value === '1' || value === 1 || value === true;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function report(danger: string[], warn: string[]): RiskReport {
  if (danger.length) return { level: 'danger', reasons: [...danger, ...warn] };
  if (warn.length) return { level: 'warn', reasons: warn };
  return OK;
}

/** Worst of several reports (danger > warn > ok > trusted). */
export function worstRisk(...reports: (RiskReport | null | undefined)[]): RiskReport | null {
  const rank: Record<RiskLevel, number> = { trusted: 0, ok: 1, warn: 2, danger: 3 };
  let worst: RiskReport | null = null;
  for (const r of reports) {
    if (!r) continue;
    if (!worst || rank[r.level] > rank[worst.level]) worst = { level: r.level, reasons: [...r.reasons] };
    else if (rank[r.level] === rank[worst.level]) worst.reasons.push(...r.reasons.filter((x) => !worst!.reasons.includes(x)));
  }
  return worst;
}

/** /token_security/{chain} entry → risk. Only strong signals; on GoPlus's trust list nothing is flagged. */
export function parseEvmTokenSecurity(raw: unknown): RiskReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (flag(t.trust_list)) return TRUSTED;
  const danger: string[] = [];
  const warn: string[] = [];
  if (flag(t.is_honeypot)) danger.push('Honeypot: this token can be bought but not sold.');
  if (flag(t.is_airdrop_scam)) danger.push('Known airdrop scam token.');
  const fake = t.fake_token as { value?: unknown } | undefined;
  if (fake && typeof fake === 'object' && flag(fake.value)) danger.push('Fake token: it copies the name of a real token.');
  const sell = num(t.sell_tax);
  const buy = num(t.buy_tax);
  if (sell !== null && sell >= 0.5) danger.push(`Sell tax is ${Math.round(sell * 100)}%.`);
  else if (sell !== null && sell >= 0.1) warn.push(`Sell tax is ${Math.round(sell * 100)}%.`);
  if (buy !== null && buy >= 0.5) danger.push(`Buy tax is ${Math.round(buy * 100)}%.`);
  if (flag(t.cannot_sell_all)) warn.push('You may not be able to sell all of it.');
  if (flag(t.honeypot_with_same_creator)) warn.push('Its creator has made honeypot tokens before.');
  if (flag(t.owner_change_balance)) warn.push('The owner can change balances.');
  if (flag(t.hidden_owner)) warn.push('It has a hidden owner.');
  if (t.is_open_source === '0') warn.push('Contract source code is not public.');
  return report(danger, warn);
}

type SolAuthority = { authority?: { address?: string; malicious_address?: unknown }[]; status?: unknown };

function solAuth(value: unknown): SolAuthority {
  return value && typeof value === 'object' ? (value as SolAuthority) : {};
}

/** /solana/token_security entry → risk. */
export function parseSolanaTokenSecurity(raw: unknown): RiskReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (flag(t.trusted_token)) return TRUSTED;
  const danger: string[] = [];
  const warn: string[] = [];
  const authorities = ['mintable', 'freezable', 'closable', 'balance_mutable_authority', 'metadata_mutable', 'transfer_fee_upgradable']
    .flatMap((k) => solAuth(t[k]).authority ?? []);
  const creators = Array.isArray(t.creators) ? (t.creators as { malicious_address?: unknown }[]) : [];
  if ([...authorities, ...creators].some((a) => flag(a?.malicious_address))) danger.push('Controlled by an address flagged as malicious.');
  if (flag(solAuth(t.balance_mutable_authority).status)) danger.push('Someone else can change your balance of this token.');
  if (flag(t.non_transferable)) danger.push('This token cannot be transferred or sold.');
  if (flag(solAuth(t.closable).status)) warn.push('The token can be closed by its authority.');
  if (flag(solAuth(t.freezable).status)) warn.push('Your tokens can be frozen by its authority.');
  if (Array.isArray(t.transfer_hook) && t.transfer_hook.length) warn.push('It runs custom code on every transfer.');
  const fee = t.transfer_fee as { current_fee_rate?: { fee_rate?: unknown } } | undefined;
  const rate = num(fee?.current_fee_rate?.fee_rate);
  if (rate !== null && rate >= 10) warn.push(`Transfer fee is ${rate}%.`);
  return report(danger, warn);
}

const ADDRESS_FLAGS: [string, string][] = [
  ['phishing_activities', 'phishing'],
  ['stealing_attack', 'stealing funds'],
  ['cybercrime', 'cybercrime'],
  ['financial_crime', 'financial crime'],
  ['money_laundering', 'money laundering'],
  ['blackmail_activities', 'blackmail'],
  ['sanctioned', 'sanctions'],
  ['darkweb_transactions', 'darkweb activity'],
  ['honeypot_related_address', 'honeypot scams'],
  ['fake_token', 'fake tokens'],
  ['fake_kyc', 'fake KYC'],
  ['malicious_mining_activities', 'malicious mining'],
  ['gas_abuse', 'gas abuse'],
  ['reinit', 'contract re-deploy attacks'],
  ['fake_standard_interface', 'fake token interfaces'],
  ['mixer', 'mixer use'],
];

/** /address_security/{address} → risk. */
export function parseAddressSecurity(raw: unknown): RiskReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const hits = ADDRESS_FLAGS.filter(([key]) => flag(a[key])).map(([, label]) => label);
  const created = num(a.number_of_malicious_contracts_created) ?? 0;
  if (created > 0) hits.push('creating malicious contracts');
  if (hits.length) return { level: 'danger', reasons: [`This address is flagged for ${hits.join(', ')}.`] };
  if (flag(a.blacklist_doubt)) return { level: 'warn', reasons: ['This address is on a suspicious-address list.'] };
  return OK;
}

/** /approval_security/{chain} (spender contract) → risk. */
export function parseApprovalSecurity(raw: unknown): RiskReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const danger: string[] = [];
  const warn: string[] = [];
  if (flag(c.doubt_list)) danger.push('The spender is on a suspicious-contract list.');
  const behavior = Array.isArray(c.malicious_behavior) ? c.malicious_behavior.filter((x) => typeof x === 'string') : [];
  if (behavior.length) danger.push(`The spender is flagged for: ${behavior.join(', ').replace(/_/g, ' ')}.`);
  if (danger.length === 0 && flag(c.trust_list)) return TRUSTED;
  if (c.is_contract === 0 || c.is_contract === '0') warn.push('The spender is a personal wallet, not an app contract. Drainers use this.');
  else if (c.is_open_source === 0 || c.is_open_source === '0') warn.push("The spender contract's code is not public.");
  return report(danger, warn);
}

/** /phishing_site → risk. */
export function parsePhishingSite(raw: unknown): RiskReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (flag(p.phishing_site)) return { level: 'danger', reasons: ['GoPlus lists this site as phishing.'] };
  const contracts = Array.isArray(p.website_contract_security) ? p.website_contract_security : [];
  if (contracts.some((c) => c && typeof c === 'object' && (flag((c as Record<string, unknown>).is_malicious) || flag((c as Record<string, unknown>).malicious_contract)))) {
    return { level: 'danger', reasons: ['This site uses contracts flagged as malicious.'] };
  }
  return OK;
}

/** GoPlus envelope: { code: 1, result }. Anything else (rate limit 4029, errors) is unknown. */
export function unwrapGoPlus(body: unknown): unknown | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { code?: unknown; result?: unknown };
  if (Number(b.code) !== 1 || b.result === undefined || b.result === null) return null;
  return b.result;
}

/** Sliding-window limiter, kept under the free tier with headroom. */
export class RateLimiter {
  private minute: number[] = [];
  private dayStart = 0;
  private dayCount = 0;

  constructor(
    private readonly perMinute = 20,
    private readonly perDay = 20_000,
    private readonly clock: () => number = Date.now,
  ) {}

  tryTake(): boolean {
    const now = this.clock();
    if (now - this.dayStart >= 86_400_000) {
      this.dayStart = now;
      this.dayCount = 0;
    }
    this.minute = this.minute.filter((t) => now - t < 60_000);
    if (this.minute.length >= this.perMinute || this.dayCount >= this.perDay) return false;
    this.minute.push(now);
    this.dayCount += 1;
    return true;
  }

  /** 429 / code 4029: stop calling for a minute. */
  backOff(): void {
    const now = this.clock();
    this.minute = Array.from({ length: this.perMinute }, () => now);
  }
}

type CacheEntry = { value: RiskReport | null; expires: number };

export type GoPlusOptions = {
  fetchImpl?: typeof fetch;
  accessToken?: string | null;
  clock?: () => number;
  limiter?: RateLimiter;
  timeoutMs?: number;
};

const TTL = {
  token: 24 * 60 * 60 * 1000,
  address: 12 * 60 * 60 * 1000,
  approval: 12 * 60 * 60 * 1000,
  site: 6 * 60 * 60 * 1000,
  /** Unknown answers (timeouts, limits) are retried after this. */
  unknown: 2 * 60 * 1000,
};
const MAX_ENTRIES = 1000;

export class GoPlusClient {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<unknown | null>>();
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => number;
  private readonly limiter: RateLimiter;
  private readonly timeoutMs: number;
  private readonly accessToken: string | null;
  /** Calls actually sent (tests / diagnostics). */
  calls = 0;

  constructor(options: GoPlusOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.clock = options.clock ?? Date.now;
    this.limiter = options.limiter ?? new RateLimiter(20, 20_000, this.clock);
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.accessToken = options.accessToken ?? null;
  }

  private read(key: string): CacheEntry | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (hit.expires <= this.clock()) {
      this.cache.delete(key);
      return null;
    }
    return hit;
  }

  private write(key: string, value: RiskReport | null, ttl: number): void {
    if (this.cache.size >= MAX_ENTRIES) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(key, { value, expires: this.clock() + (value ? ttl : TTL.unknown) });
  }

  /** GET path → unwrapped result, or null. De-duplicates identical in-flight calls. Never throws. */
  private get(path: string): Promise<unknown | null> {
    const existing = this.inflight.get(path);
    if (existing) return existing;
    const run = (async () => {
      if (!this.limiter.tryTake()) return null;
      this.calls += 1;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
      try {
        const headers: Record<string, string> = { accept: 'application/json' };
        if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
        const res = await this.fetchImpl(`${GOPLUS_BASE_URL}${path}`, { headers, signal: controller?.signal });
        if (res.status === 429) {
          this.limiter.backOff();
          return null;
        }
        if (!res.ok) return null;
        const body = (await res.json()) as { code?: unknown };
        if (Number(body?.code) === 4029) {
          this.limiter.backOff();
          return null;
        }
        return unwrapGoPlus(body);
      } catch {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    this.inflight.set(path, run);
    return run.finally(() => this.inflight.delete(path));
  }

  /** Batched token check. Returns address(lowercase) → report (null = unknown). Unsupported chains → all null. */
  async tokenRisks(chainId: number, addresses: string[]): Promise<Map<string, RiskReport | null>> {
    const out = new Map<string, RiskReport | null>();
    const wanted = [...new Set(addresses.map((a) => a.toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))];
    const missing: string[] = [];
    for (const a of wanted) {
      const hit = this.read(`t:${chainId}:${a}`);
      if (hit) out.set(a, hit.value);
      else missing.push(a);
    }
    if (!GOPLUS_EVM_CHAINS.has(chainId)) {
      for (const a of missing) out.set(a, null);
      return out;
    }
    for (let i = 0; i < missing.length; i += 20) {
      const batch = missing.slice(i, i + 20);
      const result = (await this.get(`/token_security/${chainId}?contract_addresses=${batch.join(',')}`)) as Record<string, unknown> | null;
      const lower = new Map(Object.entries(result ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      for (const a of batch) {
        const value = result ? parseEvmTokenSecurity(lower.get(a)) : null;
        this.write(`t:${chainId}:${a}`, value, TTL.token);
        out.set(a, value);
      }
    }
    return out;
  }

  /** Batched Solana mint check. Keys are the mint addresses as given. */
  async solanaTokenRisks(mints: string[]): Promise<Map<string, RiskReport | null>> {
    const out = new Map<string, RiskReport | null>();
    const wanted = [...new Set(mints.filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)))];
    const missing: string[] = [];
    for (const m of wanted) {
      const hit = this.read(`s:${m}`);
      if (hit) out.set(m, hit.value);
      else missing.push(m);
    }
    for (let i = 0; i < missing.length; i += 20) {
      const batch = missing.slice(i, i + 20);
      const result = (await this.get(`/solana/token_security?contract_addresses=${batch.join(',')}`)) as Record<string, unknown> | null;
      for (const m of batch) {
        const value = result ? parseSolanaTokenSecurity(result[m]) : null;
        this.write(`s:${m}`, value, TTL.token);
        out.set(m, value);
      }
    }
    return out;
  }

  private async cached(key: string, ttl: number, path: string, parse: (raw: unknown) => RiskReport | null): Promise<RiskReport | null> {
    const hit = this.read(key);
    if (hit) return hit.value;
    const result = await this.get(path);
    const value = result === null ? null : parse(result);
    this.write(key, value, ttl);
    return value;
  }

  /** Malicious-address check for a recipient / spender (EVM). */
  addressRisk(address: string, chainId: number): Promise<RiskReport | null> {
    const a = address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(a)) return Promise.resolve(null);
    const chain = GOPLUS_EVM_CHAINS.has(chainId) ? `?chain_id=${chainId}` : '';
    return this.cached(`a:${chainId}:${a}`, TTL.address, `/address_security/${a}${chain}`, parseAddressSecurity);
  }

  /** Spender-contract check for an approval (EVM). */
  approvalSpenderRisk(spender: string, chainId: number): Promise<RiskReport | null> {
    const a = spender.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(a) || !GOPLUS_EVM_CHAINS.has(chainId)) return Promise.resolve(null);
    return this.cached(`p:${chainId}:${a}`, TTL.approval, `/approval_security/${chainId}?contract_addresses=${a}`, parseApprovalSecurity);
  }

  /** Phishing-site check for a page / dApp URL (by origin, so one call per site). */
  siteRisk(url: string): Promise<RiskReport | null> {
    let origin: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return Promise.resolve(null);
      origin = `${parsed.protocol}//${parsed.hostname.toLowerCase()}`;
    } catch {
      return Promise.resolve(null);
    }
    return this.cached(`u:${origin}`, TTL.site, `/phishing_site?url=${encodeURIComponent(origin)}`, parsePhishingSite);
  }
}

// Expo only inlines literal `process.env.EXPO_PUBLIC_*` reads.
const BUILD_GOPLUS_FLAG: string | undefined = process.env.EXPO_PUBLIC_GOPLUS;
const BUILD_GOPLUS_TOKEN: string | undefined = process.env.EXPO_PUBLIC_GOPLUS_ACCESS_TOKEN;

let shared: GoPlusClient | null = null;

/** App-wide client (one cache + one rate limit for every screen). */
export function goplus(): GoPlusClient {
  if (!shared) {
    shared = new GoPlusClient({ accessToken: BUILD_GOPLUS_TOKEN?.trim() || null });
  }
  return shared;
}

/** GoPlus can be switched off entirely with EXPO_PUBLIC_GOPLUS=0 (default on, keyless). */
export function goplusEnabled(flag: string | undefined = BUILD_GOPLUS_FLAG): boolean {
  const v = flag?.trim();
  return v !== '0' && v !== 'false';
}
