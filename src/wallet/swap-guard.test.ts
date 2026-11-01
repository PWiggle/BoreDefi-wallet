import assert from 'node:assert/strict';
import test from 'node:test';

import { CHAIN_LIST } from './chains';
import { liFiFailureMessage, NO_ROUTE_MESSAGE, parseLiFiQuote } from './swap';
import {
  canReviewSwap,
  checkSwapPrice,
  isWrapPair,
  isWrapperRoute,
  swapQuoteKey,
  WRAPPED_NATIVE,
} from './swap-guard';
import { tokensForChain, type TokenConfig } from './tokens';
import { UserFacingError } from './tx-errors';

const eth = tokensForChain(1).find((t) => t.native)!;
const weth = tokensForChain(1).find((t) => t.symbol === 'WETH')!;
const usdt = tokensForChain(1).find((t) => t.symbol === 'USDT')!;
const usdc = tokensForChain(1).find((t) => t.symbol === 'USDC')!;

function liFi(opts: {
  chainId?: number;
  tool?: string;
  from: TokenConfig;
  to: TokenConfig;
  fromAmount: string;
  toAmount: string;
  toAmountMin?: string;
  steps?: Array<{ type: string; tool: string }>;
  toDecimals?: number;
}) {
  const chainId = opts.chainId ?? 1;
  return {
    tool: opts.tool ?? 'fly',
    toolDetails: { name: opts.tool === 'wrapper' ? 'Wrapper' : 'Fly' },
    action: {
      fromChainId: chainId,
      toChainId: chainId,
      fromAmount: opts.fromAmount,
      fromToken: { address: opts.from.address, decimals: opts.from.decimals, symbol: opts.from.symbol },
      toToken: { address: opts.to.address, decimals: opts.toDecimals ?? opts.to.decimals, symbol: opts.to.symbol },
    },
    estimate: { toAmount: opts.toAmount, toAmountMin: opts.toAmountMin ?? opts.toAmount, fromAmountUSD: '4536.74', toAmountUSD: '4513.47' },
    includedSteps: opts.steps ?? [{ type: 'swap', tool: opts.tool ?? 'fly' }],
    transactionRequest: { to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', data: '0x01', value: '0' },
  };
}

test('wrap pairs are exactly native ↔ wrapped native on every chain', () => {
  for (const chain of CHAIN_LIST) {
    const tokens = tokensForChain(chain.id);
    const native = tokens.find((t) => t.native)!;
    for (const a of tokens) {
      for (const b of tokens) {
        if (a.address === b.address) continue;
        const expected =
          (a.native && b.address.toLowerCase() === WRAPPED_NATIVE[chain.id].toLowerCase()) ||
          (b.native && a.address.toLowerCase() === WRAPPED_NATIVE[chain.id].toLowerCase());
        assert.equal(isWrapPair(chain.id, a, b), expected, `${chain.name} ${a.symbol}->${b.symbol}`);
      }
    }
    // each chain's list contains its wrapped native
    assert.ok(tokens.some((t) => t.address.toLowerCase() === WRAPPED_NATIVE[chain.id].toLowerCase()), chain.name);
    assert.ok(native);
  }
  // Polygon's WETH is bridged ETH, not wrapped POL
  const polygon = tokensForChain(137);
  assert.equal(isWrapPair(137, polygon.find((t) => t.native)!, polygon.find((t) => t.symbol === 'WETH')!), false);
  assert.equal(isWrapPair(137, polygon.find((t) => t.native)!, polygon.find((t) => t.symbol === 'WPOL')!), true);
});

test('detects wrapper routes from tool or steps', () => {
  assert.equal(isWrapperRoute('wrapper', []), true);
  assert.equal(isWrapperRoute('lifi', [{ type: 'protocol', tool: 'feeCollection' }, { type: 'protocol', tool: 'wrapper' }]), true);
  assert.equal(isWrapperRoute('fly', [{ type: 'swap', tool: 'fly' }]), false);
});

test('Patrick’s bug: a Wrapper route for ETH → USDT is refused as No route available', () => {
  const payload = liFi({ tool: 'wrapper', from: eth, to: usdt, fromAmount: '2000000000000000000', toAmount: '1995000000000000000', steps: [{ type: 'protocol', tool: 'wrapper' }] });
  assert.throws(() => parseLiFiQuote(payload, 1, 1, { from: eth, to: usdt }), (e: unknown) => e instanceof UserFacingError && e.message === NO_ROUTE_MESSAGE);
});

test('a quote for a different token than selected (the stale ETH→WETH quote) is refused', () => {
  const payload = liFi({ tool: 'wrapper', from: eth, to: weth, fromAmount: '2000000000000000000', toAmount: '1995000000000000000', steps: [{ type: 'protocol', tool: 'wrapper' }] });
  assert.throws(() => parseLiFiQuote(payload, 1, 1, { from: eth, to: usdt }), /different token/);
});

test('Wrapper is allowed for ETH ↔ WETH', () => {
  const wrap = parseLiFiQuote(
    liFi({ tool: 'wrapper', from: eth, to: weth, fromAmount: '2000000000000000000', toAmount: '1995000000000000000', steps: [{ type: 'protocol', tool: 'wrapper' }] }),
    1, 1, { from: eth, to: weth },
  );
  assert.equal(wrap.toToken.symbol, 'WETH');
  assert.equal(wrap.toToken.decimals, 18);
  const unwrap = parseLiFiQuote(
    liFi({ tool: 'wrapper', from: weth, to: eth, fromAmount: '1000000000000000000', toAmount: '1000000000000000000', steps: [{ type: 'protocol', tool: 'wrapper' }] }),
    1, 1, { from: weth, to: eth },
  );
  assert.equal(unwrap.toToken.symbol, 'ETH');
});

test('ETH → USDT uses 6 decimals for display and minimum', () => {
  const quote = parseLiFiQuote(
    liFi({ from: eth, to: usdt, fromAmount: '2000000000000000000', toAmount: '4528651697', toAmountMin: '4506008439' }),
    1, 1, { from: eth, to: usdt },
  );
  assert.equal(quote.toToken.decimals, 6);
  assert.equal(Number(quote.toAmount) / 1e6, 4528.651697);
  assert.equal(Number(quote.toAmountMin) / 1e6, 4506.008439);
});

test('decimals mismatch between quote and token list is refused', () => {
  assert.throws(
    () => parseLiFiQuote(liFi({ from: eth, to: usdt, fromAmount: '1', toAmount: '1', toDecimals: 18 }), 1, 1, { from: eth, to: usdt }),
    /wrong token decimals/,
  );
});

test('zero output is No route available', () => {
  assert.throws(() => parseLiFiQuote(liFi({ from: usdc, to: usdt, fromAmount: '1000000', toAmount: '0' }), 1, 1, { from: usdc, to: usdt }), /No route available/);
});

test('LI.FI failures map to plain lines', () => {
  assert.equal(liFiFailureMessage(404, 'No available quotes for the requested transfer'), NO_ROUTE_MESSAGE);
  assert.equal(liFiFailureMessage(400, 'something odd'), NO_ROUTE_MESSAGE);
  assert.match(liFiFailureMessage(429, ''), /busy/);
  assert.match(liFiFailureMessage(503, ''), /busy/);
});

test('price guard: the build 4 quote (1,995,000,000,000 USDT for 2 ETH) is blocked', () => {
  const result = checkSwapPrice({
    fromAmount: 2n * 10n ** 18n,
    fromDecimals: 18,
    toAmount: 1_995_000_000_000_000_000n,
    toDecimals: 6,
    fromPriceUsd: 2268,
    toPriceUsd: 1,
  });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'deviation');
});

test('price guard: a fair quote passes, >20% off is blocked, aggregator USD is the fallback', () => {
  const fair = checkSwapPrice({ fromAmount: 2n * 10n ** 18n, fromDecimals: 18, toAmount: 4_528_651_697n, toDecimals: 6, fromPriceUsd: 2268.42, toPriceUsd: 0.9995 });
  assert.equal(fair.ok, true);
  const bad = checkSwapPrice({ fromAmount: 2n * 10n ** 18n, fromDecimals: 18, toAmount: 3_500_000_000n, toDecimals: 6, fromPriceUsd: 2268.42, toPriceUsd: 1 });
  assert.equal(bad.ok, false);
  const fallback = checkSwapPrice({ fromAmount: 1n, fromDecimals: 18, toAmount: 1n, toDecimals: 6, fromPriceUsd: null, toPriceUsd: 1, aggregatorFromUsd: 4536.74, aggregatorToUsd: 4513.47 });
  assert.equal(fallback.ok && fallback.source, 'aggregator');
  const none = checkSwapPrice({ fromAmount: 1n, fromDecimals: 18, toAmount: 1n, toDecimals: 6, fromPriceUsd: null, toPriceUsd: null });
  assert.equal(!none.ok && none.reason, 'unverified');
});

test('Review swap needs a current quote, a passing pre-flight and price check', () => {
  const key = swapQuoteKey(1, eth, usdt, 2n * 10n ** 18n);
  const base = { quoteKey: key, currentKey: key, preflightOk: true, priceOk: true, busy: false };
  assert.equal(canReviewSwap(base), true);
  assert.equal(canReviewSwap({ ...base, currentKey: swapQuoteKey(1, eth, weth, 2n * 10n ** 18n) }), false);
  assert.equal(canReviewSwap({ ...base, currentKey: swapQuoteKey(1, eth, usdt, 3n * 10n ** 18n) }), false);
  assert.equal(canReviewSwap({ ...base, preflightOk: false }), false);
  assert.equal(canReviewSwap({ ...base, priceOk: false }), false);
  assert.equal(canReviewSwap({ ...base, quoteKey: null }), false);
  assert.equal(canReviewSwap({ ...base, busy: true }), false);
});
