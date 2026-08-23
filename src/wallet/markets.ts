import { logger } from '../logger';
import { type ChainId } from './chains';
import { type TokenConfig, tokensForChain } from './tokens';

const BASE = 'https://api.coingecko.com/api/v3';
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

export function coinGeckoUrl(id?: string): string {
  if (!id) {
    return COINGECKO_SITE;
  }
  return `${COINGECKO_SITE}/en/coins/${encodeURIComponent(id)}`;
}

export function parseCoinGeckoCoinId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('coingecko.com')) {
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
    return new URL(url).hostname.endsWith('coingecko.com');
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
      return 'matic-network';
    case 56:
      return 'binancecoin';
    case 43114:
      return 'avalanche-2';
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
      return 'binancecoin';
    case 'WAVAX':
      return 'avalanche-2';
    case 'STETH':
      return 'staked-ether';
    default:
      return null;
  }
}

export function portfolioTokensForChain(chainId: ChainId): TokenConfig[] {
  return tokensForChain(chainId).filter((item) => item.native || item.symbol === 'USDC' || item.symbol === 'USDT');
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

async function gecko<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { headers: COINGECKO_HEADERS });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchTrendingCoins(): Promise<MarketCoin[]> {
  try {
    return parseTrending(await gecko<TrendingPayload>('/search/trending'));
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
    return parseMarkets(
      await gecko<MarketsPayload>(
        `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=true&price_change_percentage=24h`,
      ),
    );
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
    return parseSearch(await gecko<SearchPayload>(`/search?query=${encodeURIComponent(trimmed)}`)).slice(0, 20);
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
    return parseMarkets(
      await gecko<MarketsPayload>(
        `/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`,
      ),
    );
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
    return parseCoinPage(
      await gecko<CoinPagePayload>(
        `/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true`,
      ),
    );
  } catch (error) {
    logger.error('Coin page failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Could not load this CoinGecko coin.');
  }
}
