import { logger } from '../logger';
import { type ChainId } from './chains';
import { type TokenConfig, tokensForChain } from './tokens';

const BASE = 'https://api.coingecko.com/api/v3';

/**
 * BoreDash market-data API (CoinGecko-shaped responses). Market calls try BoreDash first and fall back
 * to CoinGecko if the response headers take longer than BOREDASH_TIMEOUT_MS, if the body takes longer than
 * BOREDASH_BODY_TIMEOUT_MS to download and parse, or on any error, including a response that does not parse.
 * fetchUsdPrices (swap/bridge price guard) always goes straight to CoinGecko.
 */
export const BOREDASH_API_ENABLED = true;
export const BOREDASH_API_BASE = 'https://www.boredash.com';
/** Connect + response-headers limit for a BoreDash call. */
export const BOREDASH_TIMEOUT_MS = 6_000;
/** Separate, generous limit for downloading and parsing the body once headers have arrived (slow phones, 3G). */
export const BOREDASH_BODY_TIMEOUT_MS = 15_000;
export const BOREDASH_SITE = 'https://www.boredash.com';
/** Browser fetch forbids a custom User-Agent; only Accept is set. */
export const COINGECKO_HEADERS = { Accept: 'application/json' } as const;

export const COINGECKO_SITE = 'https://www.coingecko.com';

export type MarketCoin = {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  marketCap: number | null;
  volume24h: number | null;
  change24h: number | null;
  rank: number | null;
  imageUrl: string | null;
  sparkline: number[];
};

export type CoinPage = MarketCoin & {
  description: string | null;
  homepage: string | null;
};

export type MarketActions = {
  send: boolean;
  swap: boolean;
  stake: boolean;
  sendChainId?: ChainId;
  swapSymbol?: string;
  stakeMarketId?: string;
  stakeChainId?: ChainId;
};

type TrendingPayload = {
  coins?: Array<{
    item?: {
      id?: string;
      symbol?: string;
      name?: string;
      market_cap_rank?: number;
      thumb?: string;
      small?: string;
      large?: string;
      data?: { price?: number; price_change_percentage_24h?: { usd?: number } };
    };
  }>;
};

type MarketsPayload = Array<{
  id?: string;
  symbol?: string;
  name?: string;
  image?: string;
  current_price?: number;
  market_cap?: number;
  total_volume?: number;
  price_change_percentage_24h?: number;
  market_cap_rank?: number;
  sparkline_in_7d?: { price?: number[] };
}>;

type SearchPayload = {
  coins?: Array<{
    id?: string;
    symbol?: string;
    name?: string;
    market_cap_rank?: number;
    thumb?: string;
    large?: string;
  }>;
};

type CoinPagePayload = {
  id?: string;
  symbol?: string;
  name?: string;
  image?: { thumb?: string; small?: string; large?: string };
  description?: { en?: string };
  links?: { homepage?: Array<string | undefined> };
  market_cap_rank?: number;
  market_data?: {
    current_price?: { usd?: number };
    price_change_percentage_24h?: number;
    market_cap?: { usd?: number };
    total_volume?: { usd?: number };
    sparkline_7d?: { price?: number[] };
  };
};

const NATIVE_BY_ID: Record<string, ChainId> = {
  ethereum: 1,
  'matic-network': 137,
  'polygon-ecosystem-token': 137,
  binancecoin: 56,
  'avalanche-2': 43114,
  apecoin: 33139,
};

const SWAP_SYMBOL: Record<string, string> = {
  ethereum: 'ETH',
  'usd-coin': 'USDC',
  tether: 'USDT',
  'matic-network': 'POL',
  'polygon-ecosystem-token': 'POL',
  binancecoin: 'BNB',
  'avalanche-2': 'AVAX',
  weth: 'WETH',
  'staked-ether': 'stETH',
  apecoin: 'APE',
  wbnb: 'WBNB',
  'wrapped-avax': 'WAVAX',
  'wrapped-apecoin': 'WAPE',
  wmatic: 'WPOL',
};

function sparklinePoints(values: number[] | undefined): number[] {
  return (values ?? []).filter((value) => Number.isFinite(value));
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function coin(
  id: string,
  symbol: string,
  name: string,
  extras: Partial<Omit<MarketCoin, 'id' | 'symbol' | 'name'>> = {},
): MarketCoin {
  return {
    id,
    symbol: symbol.toUpperCase(),
    name,
    priceUsd: extras.priceUsd ?? null,
    marketCap: extras.marketCap ?? null,
    volume24h: extras.volume24h ?? null,
    change24h: extras.change24h ?? null,
    rank: extras.rank ?? null,
    imageUrl: extras.imageUrl ?? null,
    sparkline: extras.sparkline ?? [],
  };
}

/** Coin page shown in the in-app Browser when a coin is tapped. */
export function boreDashUrl(id?: string): string {
  if (!id) {
    return BOREDASH_SITE;
  }
  return `${BOREDASH_SITE}/coins/${encodeURIComponent(id)}`;
}

export function coinGeckoUrl(id?: string): string {
  if (!id) {
    return COINGECKO_SITE;
  }
  return `${COINGECKO_SITE}/en/coins/${encodeURIComponent(id)}`;
}

export function parseCoinGeckoCoinId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('coingecko.com') && !parsed.hostname.endsWith('boredash.com')) {
      return null;
    }
    const match = parsed.pathname.match(/\/coins\/([^/]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function isCoinGeckoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.endsWith('coingecko.com') || (host.endsWith('boredash.com') && /\/coins(\/|$)/.test(new URL(url).pathname));
  } catch {
    return false;
  }
}

export function rankGainers(markets: MarketCoin[]): MarketCoin[] {
  return markets
    .filter((item) => item.change24h !== null && Number.isFinite(item.change24h))
    .slice()
    .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));
}

export function hydrateMarkets(rows: MarketCoin[], details: MarketCoin[]): MarketCoin[] {
  const byId = indexMarketsById(details);
  return rows.map((row) => {
    const extra = byId.get(row.id);
    if (!extra) {
      return row;
    }
    return {
      ...row,
      priceUsd: extra.priceUsd ?? row.priceUsd,
      marketCap: extra.marketCap ?? row.marketCap,
      volume24h: extra.volume24h ?? row.volume24h,
      change24h: extra.change24h ?? row.change24h,
      rank: extra.rank ?? row.rank,
      imageUrl: extra.imageUrl ?? row.imageUrl,
      sparkline: extra.sparkline.length > 0 ? extra.sparkline : row.sparkline,
    };
  });
}

export function parseTrending(payload: TrendingPayload): MarketCoin[] {
  const out: MarketCoin[] = [];
  for (const entry of payload.coins ?? []) {
    const item = entry.item;
    if (!item?.id || !item.symbol) {
      continue;
    }
    out.push(
      coin(item.id, item.symbol, item.name ?? item.symbol, {
        priceUsd: item.data?.price ?? null,
        change24h: item.data?.price_change_percentage_24h?.usd ?? null,
        rank: item.market_cap_rank ?? null,
        imageUrl: item.large ?? item.small ?? item.thumb ?? null,
      }),
    );
  }
  return out;
}

export function parseMarkets(payload: MarketsPayload): MarketCoin[] {
  const out: MarketCoin[] = [];
  for (const item of payload) {
    if (!item.id || !item.symbol) {
      continue;
    }
    out.push(
      coin(item.id, item.symbol, item.name ?? item.symbol, {
        priceUsd: item.current_price ?? null,
        marketCap: item.market_cap ?? null,
        volume24h: item.total_volume ?? null,
        change24h: item.price_change_percentage_24h ?? null,
        rank: item.market_cap_rank ?? null,
        imageUrl: item.image ?? null,
        sparkline: sparklinePoints(item.sparkline_in_7d?.price),
      }),
    );
  }
  return out;
}

export function parseSearch(payload: SearchPayload): MarketCoin[] {
  const out: MarketCoin[] = [];
  for (const item of payload.coins ?? []) {
    if (!item.id || !item.symbol) {
      continue;
    }
    out.push(
      coin(item.id, item.symbol, item.name ?? item.symbol, {
        rank: item.market_cap_rank ?? null,
        imageUrl: item.large ?? item.thumb ?? null,
      }),
    );
  }
  return out;
}

export function actionsForMarket(coin: MarketCoin, selectedChainId: ChainId): MarketActions {
  const sendChainId = NATIVE_BY_ID[coin.id];
  const swapSymbol = SWAP_SYMBOL[coin.id] ?? (['ETH', 'USDC', 'USDT', 'WETH', 'stETH', 'POL', 'BNB', 'AVAX'].includes(coin.symbol)
    ? coin.symbol
    : undefined);
  const stakeEth = coin.id === 'ethereum' || coin.id === 'staked-ether';
  const stakeUsdc = coin.id === 'usd-coin';
  const aaveChains = new Set<ChainId>([1, 8453, 42161, 10, 137, 43114]);
  const stakeChainId: ChainId | undefined = stakeEth
    ? 1
    : stakeUsdc && aaveChains.has(selectedChainId)
      ? selectedChainId
      : stakeUsdc
        ? 8453
        : undefined;
  return {
    send: sendChainId !== undefined,
    swap: Boolean(swapSymbol),
    stake: Boolean(stakeChainId),
    sendChainId,
    swapSymbol,
    stakeMarketId: stakeEth ? 'lido-eth' : stakeUsdc && stakeChainId ? `aave-usdc-${stakeChainId}` : undefined,
    stakeChainId,
  };
}

export function geckoIdForNative(chainId: ChainId): string {
  switch (chainId) {
    case 137:
      // POL replaced MATIC; CoinGecko keeps a separate (stale-priced) matic-network id.
      return 'polygon-ecosystem-token';
    case 56:
      return 'binancecoin';
    case 43114:
      return 'avalanche-2';
    case 33139:
      return 'apecoin';
    default:
      return 'ethereum';
  }
}

export function geckoIdForToken(token: TokenConfig): string | null {
  if (token.native) {
    return geckoIdForNative(token.chainId);
  }
  switch (token.symbol.toUpperCase()) {
    case 'USDC':
      return 'usd-coin';
    case 'USDT':
      return 'tether';
    case 'WETH':
      return 'weth';
    case 'WBNB':
      return 'wbnb';
    case 'WAVAX':
      return 'wrapped-avax';
    case 'WPOL':
      // CoinGecko's 'wmatic' coin is Wrapped POL (WPOL); 'polygon-ecosystem-token' is the native POL.
      return 'wmatic';
    case 'STETH':
      return 'staked-ether';
    case 'APE':
      return 'apecoin';
    case 'WAPE':
      return 'wrapped-apecoin';
    case 'APEUSD':
      return 'apeusd';
    default:
      return null;
  }
}

/** Every token the wallet knows on this chain (native, stablecoins, wrapped native, WETH, stETH, APE…). */
export function portfolioTokensForChain(chainId: ChainId): TokenConfig[] {
  return tokensForChain(chainId);
}

/**
 * Home total in USD: sum of every held token priced by its gecko id. Unpriced zero balances are ignored;
 * returns null when the native price is missing or a held token has no price (so the total is never silently low).
 */
export function portfolioUsdTotal(
  rows: { token: Pick<TokenConfig, 'native' | 'decimals'>; amount: bigint; priceUsd: number | null | undefined }[],
): number | null {
  let total = 0;
  for (const row of rows) {
    if (row.amount <= 0n) {
      if (row.token.native && (row.priceUsd === null || row.priceUsd === undefined)) {
        return null;
      }
      continue;
    }
    const value = usdValueFromUnits(row.amount, row.token.decimals, row.priceUsd);
    if (value === null) {
      return null;
    }
    total += value;
  }
  return total;
}

export function usdValueFromUnits(raw: bigint, decimals: number, priceUsd: number | null | undefined): number | null {
  if (priceUsd === null || priceUsd === undefined || !Number.isFinite(priceUsd)) {
    return null;
  }
  const amount = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(amount)) {
    return null;
  }
  return amount * priceUsd;
}

export function indexMarketsById(markets: MarketCoin[]): Map<string, MarketCoin> {
  return new Map(markets.map((item) => [item.id, item]));
}

type MarketFetch = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** Ordered list of API bases to try for a market call. */
export function marketBases(enabled: boolean = BOREDASH_API_ENABLED): string[] {
  return enabled ? [BOREDASH_API_BASE, BASE] : [BASE];
}

/** A market call: the BoreDash route (null = CoinGecko only) and the CoinGecko v3 path. */
export type MarketRoute = { boredash: string | null; gecko: string };

const q = encodeURIComponent;

export const MARKET_ROUTES = {
  top: (perPage: number): MarketRoute => ({
    boredash: `/api/wallet/top?limit=${perPage}&sparkline=true`,
    gecko: `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=true&price_change_percentage=24h`,
  }),
  details: (ids: string[]): MarketRoute => ({
    boredash: `/api/markets?ids=${q(ids.join(','))}&sparkline=true`,
    gecko: `/coins/markets?vs_currency=usd&ids=${q(ids.join(','))}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`,
  }),
  trending: (): MarketRoute => ({ boredash: '/api/wallet/trending', gecko: '/search/trending' }),
  search: (query: string): MarketRoute => ({ boredash: `/api/search?q=${q(query)}`, gecko: `/search?query=${q(query)}` }),
  coin: (id: string): MarketRoute => ({
    boredash: `/api/wallet/coin/${q(id)}`,
    gecko: `/coins/${q(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true`,
  }),
  /** Fee display prices (network fee in $): BoreDash first, CoinGecko fallback. */
  walletPrices: (ids: string[]): MarketRoute => ({
    boredash: `/api/wallet/prices?ids=${q(ids.join(','))}`,
    gecko: `/simple/price?ids=${q(ids.join(','))}&vs_currencies=usd`,
  }),
  usdPrices: (ids: string[]): MarketRoute => ({
    boredash: null,
    gecko: `/simple/price?ids=${q(ids.join(','))}&vs_currencies=usd`,
  }),
} as const;

/** Where a market call goes, in order. */
export function marketUrls(route: MarketRoute, enabled: boolean = BOREDASH_API_ENABLED): string[] {
  const urls = [`${BASE}${route.gecko}`];
  return enabled && route.boredash ? [`${BOREDASH_API_BASE}${route.boredash}`, ...urls] : urls;
}

/**
 * GET a CoinGecko-shaped path. With BoreDash enabled, BoreDash is tried first: the connect/headers timer
 * (BOREDASH_TIMEOUT_MS) is cleared as soon as the response headers arrive, then the body gets its own
 * BOREDASH_BODY_TIMEOUT_MS to download and parse. Any BoreDash failure (timeout, HTTP error, truncated or
 * unparseable body) falls back to CoinGecko; the last error is thrown only if every base fails.
 */
export async function fetchMarketJson<T, R = T>(
  route: string | MarketRoute,
  options: {
    enabled?: boolean;
    fetchImpl?: MarketFetch;
    /** Connect + headers limit for BoreDash. */
    timeoutMs?: number;
    /** Body download + parse limit for BoreDash, started once headers arrive. */
    bodyTimeoutMs?: number;
    /** Runs per source, so a BoreDash payload that does not parse also falls back to CoinGecko. */
    parse?: (payload: T) => R;
  } = {},
): Promise<R> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as MarketFetch);
  const resolved: MarketRoute = typeof route === 'string' ? { boredash: route, gecko: route } : route;
  const urls = marketUrls(resolved, options.enabled ?? BOREDASH_API_ENABLED);
  const parse = options.parse ?? ((payload: T) => payload as unknown as R);
  let lastError: unknown = null;
  for (const url of urls) {
    const primary = url.startsWith(BOREDASH_API_BASE);
    const controller = primary && typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timedOut: 'headers' | 'body' | null = null;
    const arm = (phase: 'headers' | 'body', ms: number) => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = controller
        ? setTimeout(() => {
            timedOut = phase;
            controller.abort();
          }, ms)
        : null;
    };
    try {
      arm('headers', options.timeoutMs ?? BOREDASH_TIMEOUT_MS);
      const response = await fetchImpl(url, {
        headers: COINGECKO_HEADERS,
        ...(controller ? { signal: controller.signal } : {}),
      });
      // Headers are in: stop the connect timer and give the body its own, longer limit.
      arm('body', options.bodyTimeoutMs ?? BOREDASH_BODY_TIMEOUT_MS);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as T;
      if (timedOut) {
        throw new Error(`BoreDash ${timedOut} timeout`);
      }
      return parse(payload);
    } catch (error) {
      lastError = error;
      if (primary) {
        logger.warn('markets: BoreDash failed, falling back to CoinGecko', {
          url,
          error: String(error),
          ...(timedOut ? { timedOut } : {}),
        });
      }
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Market data unavailable.');
}

/** A top-markets list that comes back empty is treated as a failure, so the next source is tried. */
function nonEmpty<T>(parse: (payload: T) => MarketCoin[]): (payload: T) => MarketCoin[] {
  return (payload) => {
    const out = parse(payload);
    if (out.length === 0) {
      throw new Error('Empty market list');
    }
    return out;
  };
}

function market<T, R>(route: MarketRoute, parse: (payload: T) => R): Promise<R> {
  return fetchMarketJson<T, R>(route, { parse });
}

export async function fetchTrendingCoins(): Promise<MarketCoin[]> {
  try {
    return await market<TrendingPayload, MarketCoin[]>(MARKET_ROUTES.trending(), parseTrending);
  } catch (error) {
    logger.error('Trending markets failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Could not load trending tokens.');
  }
}

export async function fetchTopMarkets(limit = 100): Promise<MarketCoin[]> {
  const perPage = Math.min(250, Math.max(1, limit));
  try {
    return await market<MarketsPayload, MarketCoin[]>(MARKET_ROUTES.top(perPage), nonEmpty(parseMarkets));
  } catch (error) {
    logger.error('Market list failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Could not load market stats.');
  }
}

export async function searchMarkets(query: string): Promise<MarketCoin[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  try {
    return (await market<SearchPayload, MarketCoin[]>(MARKET_ROUTES.search(trimmed), parseSearch)).slice(0, 20);
  } catch (error) {
    logger.error('Market search failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Could not search tokens.');
  }
}

export async function fetchMarketDetails(ids: string[]): Promise<MarketCoin[]> {
  if (ids.length === 0) {
    return [];
  }
  try {
    return await market<MarketsPayload, MarketCoin[]>(MARKET_ROUTES.details(ids), parseMarkets);
  } catch (error) {
    logger.error('Market details failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Could not load token stats.');
  }
}

export function parseCoinPage(payload: CoinPagePayload): CoinPage {
  const id = payload.id ?? '';
  const symbol = payload.symbol ?? '';
  if (!id || !symbol) {
    throw new Error('Could not load CoinGecko coin.');
  }
  const description = payload.description?.en ? stripHtml(payload.description.en) : null;
  const homepage = payload.links?.homepage?.find((item) => Boolean(item)) ?? null;
  return {
    ...coin(id, symbol, payload.name ?? symbol, {
      priceUsd: payload.market_data?.current_price?.usd ?? null,
      change24h: payload.market_data?.price_change_percentage_24h ?? null,
      marketCap: payload.market_data?.market_cap?.usd ?? null,
      volume24h: payload.market_data?.total_volume?.usd ?? null,
      rank: payload.market_cap_rank ?? null,
      imageUrl: payload.image?.large ?? payload.image?.small ?? payload.image?.thumb ?? null,
      sparkline: sparklinePoints(payload.market_data?.sparkline_7d?.price),
    }),
    description,
    homepage,
  };
}

export async function fetchCoinPage(id: string): Promise<CoinPage> {
  try {
    return await market<CoinPagePayload, CoinPage>(MARKET_ROUTES.coin(id), parseCoinPage);
  } catch (error) {
    logger.error('Coin page failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Could not load this CoinGecko coin.');
  }
}

/** USD prices for CoinGecko ids, used by the swap price guard. Missing ids are left out. */
export async function fetchUsdPrices(
  ids: string[],
  options: { fetchImpl?: MarketFetch; retryDelayMs?: number } = {},
): Promise<Record<string, number>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) {
    return {};
  }
  // Price guard stays on CoinGecko directly (no BoreDash hop). One retry for a dropped request or a 429/5xx,
  // so a single blip does not leave the guard on its fallback (the aggregator's own USD estimate).
  let payload: Record<string, { usd?: number }> | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2 && payload === null; attempt += 1) {
    try {
      payload = await fetchMarketJson<Record<string, { usd?: number }>>(MARKET_ROUTES.usdPrices(unique), {
        enabled: false,
        fetchImpl: options.fetchImpl,
      });
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, options.retryDelayMs ?? 700));
      }
    }
  }
  if (payload === null) {
    throw lastError instanceof Error ? lastError : new Error('Price feed unavailable.');
  }
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(payload ?? {})) {
    if (typeof value?.usd === 'number' && Number.isFinite(value.usd)) {
      out[id] = value.usd;
    }
  }
  return out;
}

/**
 * USD prices for fee display (swap confirm "about $0.18", Gas screen). BoreDash /api/wallet/prices first,
 * CoinGecko /simple/price as the fallback. The swap price guard keeps using fetchUsdPrices (CoinGecko direct).
 */
export async function fetchWalletUsdPrices(
  ids: string[],
  options: { fetchImpl?: MarketFetch } = {},
): Promise<Record<string, number>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) {
    return {};
  }
  const payload = await fetchMarketJson<Record<string, { usd?: number }>>(MARKET_ROUTES.walletPrices(unique), {
    fetchImpl: options.fetchImpl,
  });
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(payload ?? {})) {
    if (typeof value?.usd === 'number' && Number.isFinite(value.usd)) {
      out[id] = value.usd;
    }
  }
  return out;
}
