import { type ChainId } from './chains';
import { isNativeTokenAddress, type TokenConfig } from './tokens';

/** Canonical wrapped native token per chain. Only these pairs may use a wrap/unwrap ("Wrapper") route. */
export const WRAPPED_NATIVE: Record<ChainId, string> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  10: '0x4200000000000000000000000000000000000006', // WETH
  8453: '0x4200000000000000000000000000000000000006', // WETH
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WPOL (Polygon "WETH" 0x7ceB… is bridged ETH, not a wrap)
  56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  43114: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
};

const EEEE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export function sameTokenAddress(a: string, b: string): boolean {
  const norm = (value: string) => (isNativeTokenAddress(value) || value.toLowerCase() === EEEE ? 'native' : value.toLowerCase());
  return norm(a) === norm(b);
}

export function isWrappedNative(chainId: ChainId, address: string): boolean {
  return sameTokenAddress(WRAPPED_NATIVE[chainId], address);
}

/** True only for native ↔ wrapped-native on the same chain (ETH↔WETH, POL↔WPOL, BNB↔WBNB, AVAX↔WAVAX). */
export function isWrapPair(chainId: ChainId, from: Pick<TokenConfig, 'address' | 'native'>, to: Pick<TokenConfig, 'address' | 'native'>): boolean {
  const fromNative = from.native || isNativeTokenAddress(from.address);
  const toNative = to.native || isNativeTokenAddress(to.address);
  return (fromNative && isWrappedNative(chainId, to.address)) || (toNative && isWrappedNative(chainId, from.address));
}

/** True when the aggregator picked a wrap/unwrap step. */
export function isWrapperRoute(tool: string | undefined, steps: Array<{ type?: string; tool?: string }> | undefined): boolean {
  const isWrap = (value: string | undefined) => (value ?? '').toLowerCase().includes('wrap');
  return isWrap(tool) || (steps ?? []).some((step) => isWrap(step.tool));
}

export const PRICE_DEVIATION_LIMIT = 0.2;

export type PriceCheck =
  | { ok: true; deviation: number; source: 'feed' | 'aggregator' }
  | { ok: false; reason: 'deviation'; deviation: number; message: string }
  | { ok: false; reason: 'unverified'; message: string };

function units(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/**
 * Compares what the route pays out (in USD) with what the input is worth (in USD).
 * Uses the price feed (CoinGecko) first, and the aggregator's own USD estimates only when the feed is unavailable.
 * More than 20% apart blocks the swap.
 */
export function checkSwapPrice(input: {
  fromAmount: bigint;
  fromDecimals: number;
  toAmount: bigint;
  toDecimals: number;
  fromPriceUsd: number | null;
  toPriceUsd: number | null;
  aggregatorFromUsd?: number | null;
  aggregatorToUsd?: number | null;
}): PriceCheck {
  let inUsd: number | null = null;
  let outUsd: number | null = null;
  let source: 'feed' | 'aggregator' = 'feed';
  if (input.fromPriceUsd && input.toPriceUsd) {
    inUsd = units(input.fromAmount, input.fromDecimals) * input.fromPriceUsd;
    outUsd = units(input.toAmount, input.toDecimals) * input.toPriceUsd;
  } else if (input.aggregatorFromUsd && input.aggregatorToUsd) {
    inUsd = input.aggregatorFromUsd;
    outUsd = input.aggregatorToUsd;
    source = 'aggregator';
  }
  if (inUsd === null || outUsd === null || !Number.isFinite(inUsd) || !Number.isFinite(outUsd) || inUsd <= 0) {
    return { ok: false, reason: 'unverified', message: 'Could not check this price right now. Try again in a moment.' };
  }
  const deviation = Math.abs(outUsd - inUsd) / inUsd;
  if (deviation > PRICE_DEVIATION_LIMIT) {
    return {
      ok: false,
      reason: 'deviation',
      deviation,
      message: `This quote is ${Math.round(deviation * 100)}% away from the market price. Swap blocked to protect your funds.`,
    };
  }
  return { ok: true, deviation, source };
}

/** Identifies exactly what a quote was for. A quote is only usable while this still matches the screen. */
export function swapQuoteKey(chainId: ChainId, from: Pick<TokenConfig, 'address'>, to: Pick<TokenConfig, 'address'>, amount: bigint): string {
  return `${chainId}:${from.address.toLowerCase()}:${to.address.toLowerCase()}:${amount.toString()}`;
}

/** Everything that must be true before Review swap is enabled. */
export function canReviewSwap(input: {
  quoteKey: string | null;
  currentKey: string;
  preflightOk: boolean;
  priceOk: boolean;
  busy: boolean;
}): boolean {
  return !input.busy && input.preflightOk && input.priceOk && input.quoteKey !== null && input.quoteKey === input.currentKey;
}

/** Same idea as swapQuoteKey for Bridge: source chain, destination chain, both tokens and the amount. */
export function bridgeQuoteKey(
  fromChainId: ChainId,
  toChainId: ChainId,
  from: Pick<TokenConfig, 'address'>,
  to: Pick<TokenConfig, 'address'>,
  amount: bigint,
): string {
  return `${fromChainId}>${toChainId}:${from.address.toLowerCase()}:${to.address.toLowerCase()}:${amount.toString()}`;
}
