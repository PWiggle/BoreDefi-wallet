import assert from 'node:assert/strict';
import test from 'node:test';

import { approvalAmounts, type SwapQuote } from './swap';
import { swapSimCalls } from './swap-preview';
import { tokensForChain, type TokenConfig } from './tokens';
import {
  fetchZeroExQuote,
  isZeroExAllowanceHolder,
  parseZeroExQuote,
  ZEROX_NATIVE,
  zeroExRequestBody,
  zeroExTokenAddress,
  type ProxyQuoteResponse,
} from './zerox';

const HOLDER = '0x0000000000001fF3684f28c67538d4D072C22734';
const TAKER = '0x1111111111111111111111111111111111111111';
const base = tokensForChain(8453);
const ETH = base.find((token) => token.native)!;
const USDC = base.find((token) => token.symbol === 'USDC')!;

function sellUsdc(overrides: Partial<NonNullable<ProxyQuoteResponse['quote']>> = {}): ProxyQuoteResponse {
  return {
    configured: true,
    quote: {
      chainId: 8453,
      sellAmount: '1000000',
      buyAmount: '471073987452298',
      minBuyAmount: '468718617515037',
      priceImpactPct: 0.05,
      slippageBps: 50,
      networkFeeWei: '12960221093208',
      feeBps: 30,
      feeAmount: '3000',
      feeSide: 'sell',
      allowance: { spender: HOLDER, actual: '0' },
      balanceIssue: false,
      liquidityAvailable: true,
      transaction: { to: HOLDER, data: '0x2213bc0b00', value: '0', gas: '259668' },
      ...overrides,
    },
  };
}

const expectUsdc = { chainId: 8453 as const, fromToken: USDC, toToken: ETH, fromAmount: 1_000_000n };

test('0x request maps the native coin to 0xEeee… and sends the taker, amount and slippage', () => {
  assert.equal(zeroExTokenAddress(ETH), ZEROX_NATIVE);
  assert.equal(zeroExTokenAddress(USDC), USDC.address);
  const body = zeroExRequestBody({ chainId: 8453, fromToken: ETH, toToken: USDC, fromAmount: 10n ** 15n, fromAddress: TAKER });
  assert.deepEqual(body, {
    chainId: 8453,
    sellToken: ZEROX_NATIVE,
    buyToken: USDC.address,
    sellAmount: '1000000000000000',
    slippageBps: 50,
    taker: TAKER,
  });
  // No API key or fee recipient is ever sent from the app: the proxy adds them.
  assert.ok(!('swapFeeRecipient' in body) && !('swapFeeBps' in body) && !('apiKey' in body));
});

test('a token-sell quote parses with the 0.30% fee, price impact, network fee and the AllowanceHolder spender', () => {
  const quote = parseZeroExQuote(sellUsdc(), expectUsdc);
  assert.equal(quote.tool, '0x');
  assert.equal(quote.approvalAddress, HOLDER);
  assert.equal(quote.toAmount, 471073987452298n);
  assert.equal(quote.toAmountMin, 468718617515037n);
  assert.equal(quote.transactionRequest.value, 0n);
  assert.equal(quote.transactionRequest.gasLimit, (259668n * 12n) / 10n);
  assert.deepEqual(
    { ...quote.fees, feeToken: quote.fees?.feeToken.symbol },
    { provider: '0x', feeBps: 30, feeAmount: 3000n, feeToken: 'USDC', priceImpactPct: 0.05, networkFeeWei: 12960221093208n, slippageBps: 50 },
  );
});

test('an ETH-sell quote needs no approval and must carry exactly the sold ETH as value', () => {
  const sellEth = sellUsdc({
    sellAmount: '1000000000000000',
    feeSide: 'buy',
    allowance: null,
    transaction: { to: HOLDER, data: '0x2213bc0b00', value: '1000000000000000', gas: '284340' },
  });
  const expected = { chainId: 8453 as const, fromToken: ETH, toToken: USDC, fromAmount: 10n ** 15n };
  const quote = parseZeroExQuote(sellEth, expected);
  assert.equal(quote.approvalAddress, null);
  assert.equal(quote.transactionRequest.value, 10n ** 15n);
  assert.equal(quote.fees?.feeToken.symbol, 'USDC');
  const wrongValue = sellUsdc({ ...sellEth.quote, transaction: { to: HOLDER, data: '0x22', value: '2000000000000000' } });
  assert.throws(() => parseZeroExQuote(wrongValue, expected), /different amount of the native coin/);
});

test('a quote whose tx or approval spender is not 0x AllowanceHolder is blocked', () => {
  const evil = '0x9999999999999999999999999999999999999999';
  assert.throws(() => parseZeroExQuote(sellUsdc({ transaction: { to: evil, data: '0x22', value: '0' } }), expectUsdc), /not 0x/);
  assert.throws(() => parseZeroExQuote(sellUsdc({ allowance: { spender: evil, actual: '0' } }), expectUsdc), /approval is for a contract that is not 0x/);
  assert.throws(
    () => parseZeroExQuote(sellUsdc({ transaction: { to: HOLDER, data: '0x22', value: '5' } }), expectUsdc),
    /native coin/,
  );
  assert.ok(isZeroExAllowanceHolder(HOLDER.toLowerCase()));
  assert.ok(!isZeroExAllowanceHolder(evil));
});

test('a fee above 0.30% is refused; a lower fee is shown as-is', () => {
  assert.throws(() => parseZeroExQuote(sellUsdc({ feeBps: 31 }), expectUsdc), /higher than BoreDefi charges/);
  assert.equal(parseZeroExQuote(sellUsdc({ feeBps: 0, feeAmount: '0' }), expectUsdc).fees?.feeBps, 0);
});

test('quotes for another chain, another amount, no liquidity, a balance issue or no transaction are refused', () => {
  assert.throws(() => parseZeroExQuote(sellUsdc({ chainId: 1 }), expectUsdc), /different network/);
  assert.throws(() => parseZeroExQuote(sellUsdc({ sellAmount: '999' }), expectUsdc), /different amount/);
  assert.throws(() => parseZeroExQuote(sellUsdc({ liquidityAvailable: false }), expectUsdc), /No route/);
  assert.throws(() => parseZeroExQuote(sellUsdc({ balanceIssue: true }), expectUsdc), /Not enough USDC/);
  assert.throws(() => parseZeroExQuote(sellUsdc({ transaction: null }), expectUsdc), /transaction to sign/);
  assert.throws(() => parseZeroExQuote(sellUsdc({ minBuyAmount: '999999999999999999' }), expectUsdc), /No route/);
  assert.throws(() => parseZeroExQuote({ configured: false, missing: ['ZEROX_API_KEY'] }, expectUsdc), /not set up/);
});

test('fetchZeroExQuote POSTs to the proxy /api/quote and maps a 4xx error message', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const ok = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(sellUsdc()), { status: 200 });
  }) as unknown as typeof fetch;
  const quote = await fetchZeroExQuote({ ...expectUsdc, fromAddress: TAKER, proxy: 'https://proxy.test', fetcher: ok });
  assert.equal(quote.toAmountMin, 468718617515037n);
  assert.equal(calls[0]?.url, 'https://proxy.test/api/quote');
  assert.equal(calls[0]?.init.method, 'POST');
  const bad = (async () => new Response(JSON.stringify({ error: 'Choose a supported chain.' }), { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(fetchZeroExQuote({ ...expectUsdc, fromAddress: TAKER, proxy: 'https://proxy.test', fetcher: bad }), /supported chain/);
  await assert.rejects(fetchZeroExQuote({ ...expectUsdc, toToken: USDC, fromAddress: TAKER, fetcher: ok }), /two different tokens/);
});

test('approvals are exact-amount only, skipped when covered, and reset to 0 first for Ethereum USDT', () => {
  const usdt = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
  assert.deepEqual(approvalAmounts(8453, USDC.address, 0n, 100n), [100n]);
  assert.deepEqual(approvalAmounts(8453, USDC.address, 100n, 100n), []);
  assert.deepEqual(approvalAmounts(8453, USDC.address, 5n, 100n), [100n]);
  assert.deepEqual(approvalAmounts(1, usdt, 5n, 100n), [0n, 100n]);
  assert.deepEqual(approvalAmounts(1, usdt, 0n, 100n), [100n]);
});

test('the swap preview simulates every approval step before the 0x swap', () => {
  const quote = parseZeroExQuote(sellUsdc(), expectUsdc) as SwapQuote;
  const calls = swapSimCalls(TAKER, USDC as TokenConfig, quote, true, [0n, 1_000_000n]);
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.to, USDC.address);
  assert.equal(calls[2]?.to, HOLDER);
});
