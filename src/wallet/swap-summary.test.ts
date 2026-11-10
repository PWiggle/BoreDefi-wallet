import assert from 'node:assert/strict';
import test from 'node:test';

import { bpsLabel, nativeSwapEnabled, proxyBase, ZEROX_CHAINS } from './swap-config';
import { holdingsFirst } from './swap-holdings';
import { checkPriceImpact, formatPriceImpact, requoteStillFair, swapSummaryRows } from './swap-summary';
import { tokensForChain } from './tokens';
import { parseZeroExQuote } from './zerox';

const HOLDER = '0x0000000000001fF3684f28c67538d4D072C22734';

test('swap proxy URLs must be https (http only for local dev) and lose trailing slashes', () => {
  assert.equal(proxyBase(undefined, 'https://boredswap.app'), 'https://boredswap.app');
  assert.equal(proxyBase('https://swap.example.com/', 'x'), 'https://swap.example.com');
  assert.equal(proxyBase('http://evil.example.com', 'https://boredswap.app'), 'https://boredswap.app');
  assert.equal(proxyBase('http://localhost:3000', 'x'), 'http://localhost:3000');
  assert.equal(proxyBase('not a url', 'https://mevvy.app'), 'https://mevvy.app');
  assert.equal(nativeSwapEnabled(undefined), true);
  assert.equal(nativeSwapEnabled('0'), false);
  assert.equal(bpsLabel(30), '0.30%');
  assert.equal(bpsLabel(50), '0.50%');
  assert.equal(ZEROX_CHAINS.has(33139), false, 'BoredSwap does not quote ApeChain; LI.FI stays the fallback there');
});

test('summary rows show receive, minimum, price impact, network fee, the BoreDefi 0.30% fee and slippage', () => {
  const tokens = tokensForChain(8453);
  const eth = tokens.find((token) => token.native)!;
  const usdc = tokens.find((token) => token.symbol === 'USDC')!;
  const quote = parseZeroExQuote(
    {
      configured: true,
      quote: {
        chainId: 8453,
        sellAmount: '1000000000000000',
        buyAmount: '2103037',
        minBuyAmount: '2092522',
        priceImpactPct: 0,
        slippageBps: 50,
        networkFeeWei: '2098774175814',
        feeBps: 30,
        feeAmount: '6337',
        feeSide: 'buy',
        allowance: null,
        liquidityAvailable: true,
        transaction: { to: HOLDER, data: '0x2213', value: '1000000000000000', gas: '284340' },
      },
    },
    { chainId: 8453, fromToken: eth, toToken: usdc, fromAmount: 10n ** 15n },
  );
  const rows = Object.fromEntries(swapSummaryRows(quote, { symbol: 'ETH', decimals: 18 }).map((row) => [row.label, row.value]));
  assert.equal(rows['You receive (est.)'], '2.103037 USDC');
  assert.equal(rows['Minimum received'], '2.092522 USDC');
  assert.equal(rows['Price impact'], '<0.01%');
  assert.match(rows['Network fee (est.)'] ?? '', /ETH$/);
  assert.equal(rows['BoreDefi fee'], '0.30% · 0.006337 USDC');
  assert.equal(rows['Max slippage'], '0.50%');
});

test('price impact: warn from 3%, block from 15%', () => {
  assert.equal(formatPriceImpact(null), 'Not reported');
  assert.equal(formatPriceImpact(1.234), '1.23%');
  assert.equal(checkPriceImpact(0.5).level, 'ok');
  assert.equal(checkPriceImpact(4).level, 'warn');
  assert.equal(checkPriceImpact(15).level, 'block');
  assert.equal(checkPriceImpact(null).level, 'ok');
});

test('after an approval the fresh quote is used only if its minimum is within 1% of the reviewed one', () => {
  assert.equal(requoteStillFair(10_000n, 9_900n), true);
  assert.equal(requoteStillFair(10_000n, 9_899n), false);
  assert.equal(requoteStillFair(10_000n, 12_000n), true);
});

test('From lists held tokens first and keeps the full list until balances load', () => {
  const tokens = tokensForChain(1);
  assert.deepEqual(holdingsFirst(tokens, {}), tokens);
  const usdc = tokens.find((token) => token.symbol === 'USDC')!;
  const ordered = holdingsFirst(tokens, { [usdc.address.toLowerCase()]: 5n });
  assert.equal(ordered[0]?.symbol, 'USDC');
  assert.equal(ordered.length, tokens.length);
});
