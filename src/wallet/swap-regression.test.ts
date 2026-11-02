/**
 * REGRESSION LOCKS for the build 11 Swap/Bridge "Network problem" banner (fix 0f71d9f / 3c98aa9).
 * If one of these fails, a change has reintroduced that bug class. Fix the change, do not loosen the test.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { FallbackProvider, JsonRpcProvider, type AbstractProvider } from 'ethers';

import { CHAIN_LIST } from './chains';
import { getEndpointProviders, getProvider, readWithFallback, RPC_PROVIDER_OPTIONS } from './rpc';
import { checkSwapPrice, swapBalanceGate } from './swap-guard';
import { balanceKeyFor, initialSpendView, spendBanner, spendViewReducer, type SpendView } from './spend-view';

const OWNER = '0xd8da6bf26964af9d7eed9e604bca6ca4cbfc7a6e';

type Mode = 'ok' | '429' | '500' | 'hang';

async function rpc(mode: Mode) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = JSON.parse(body) as { id: number; method: string };
      if (mode !== 'ok' && msg.method !== 'eth_blockNumber') {
        if (mode === 'hang') return; // never answers
        res.statusCode = mode === '429' ? 429 : 500;
        res.end(mode === '429' ? 'Too Many Requests' : '{"error":"boom"}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'eth_blockNumber' ? '0x10' : '0x2a' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => { server.closeAllConnections(); server.close(); } };
}

/** Same shape as getProvider + getEndpointProviders: FallbackProvider over [bad, good], then each endpoint. */
async function balanceWithOneBadRpc(mode: Exclude<Mode, 'ok'>): Promise<bigint> {
  const bad = await rpc(mode);
  const good = await rpc('ok');
  const badP = new JsonRpcProvider(bad.url, 1, RPC_PROVIDER_OPTIONS);
  const goodP = new JsonRpcProvider(good.url, 1, RPC_PROVIDER_OPTIONS);
  const fallback = new FallbackProvider(
    [
      { provider: badP, priority: 1, stallTimeout: 1500, weight: 1 },
      { provider: goodP, priority: 2, stallTimeout: 1500, weight: 1 },
    ],
    1,
    { quorum: 1 },
  );
  try {
    return await readWithFallback(1, (p) => p.getBalance(OWNER), [fallback, badP, goodP], 2_000);
  } finally {
    fallback.destroy();
    badP.destroy();
    goodP.destroy();
    bad.close();
    good.close();
  }
}

for (const mode of ['429', '500', 'hang'] as const) {
  test(`REGRESSION rpc-fallback: one RPC answering ${mode === 'hang' ? 'never (timeout)' : `HTTP ${mode}`} next to a healthy one still returns the balance`, async () => {
    assert.equal(await balanceWithOneBadRpc(mode), 42n);
  });
}

test('REGRESSION rpc-batching-off: every app RPC provider sends one request per HTTP call (batchMaxCount 1)', () => {
  assert.equal(RPC_PROVIDER_OPTIONS.batchMaxCount, 1);
  for (const chain of CHAIN_LIST) {
    const endpoints = getEndpointProviders(chain.id);
    assert.ok(endpoints.length > 0);
    for (const p of endpoints) {
      assert.equal((p as unknown as { _getOption(k: string): unknown })._getOption('batchMaxCount'), 1, `${chain.name} endpoint`);
    }
    const main = getProvider(chain.id) as AbstractProvider;
    const inner =
      main instanceof FallbackProvider ? main.providerConfigs.map((c) => c.provider) : [main];
    for (const p of inner) {
      assert.equal((p as unknown as { _getOption(k: string): unknown })._getOption('batchMaxCount'), 1, `${chain.name} fallback member`);
    }
  }
});

const ETH_KEY = balanceKeyFor(1, '0x0000000000000000000000000000000000000000');
const USDC_KEY = balanceKeyFor(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const BASE_ETH_KEY = balanceKeyFor(8453, '0x0000000000000000000000000000000000000000');
const loaded = (state: SpendView, key: string, balance: bigint) =>
  spendViewReducer(state, { type: 'balance', balanceKey: key, result: { balance, error: null } });

test('REGRESSION banner-clears-on-chain-change: a Network problem banner does not follow the user to another chain', () => {
  let s = initialSpendView('1:eth:usdc', ETH_KEY);
  s = spendViewReducer(s, { type: 'error', message: 'Network problem while getting a swap quote from LI.FI.' });
  s = spendViewReducer(s, { type: 'balance', balanceKey: ETH_KEY, result: { balance: null, error: 'Network problem while loading your ETH balance.' } });
  assert.ok(spendBanner(s));
  s = spendViewReducer(s, { type: 'context', errorKey: '8453:eth:usdc', balanceKey: BASE_ETH_KEY });
  assert.equal(spendBanner(s), null);
});

test('REGRESSION banner-clears-on-token-change: switching From or To token clears the quote error', () => {
  let s = initialSpendView('1:eth:usdc', ETH_KEY);
  s = loaded(s, ETH_KEY, 10n);
  s = spendViewReducer(s, { type: 'error', message: 'No route available' });
  // To token only: error clears, the From balance is kept (same chain + spent token).
  s = spendViewReducer(s, { type: 'context', errorKey: '1:eth:weth', balanceKey: ETH_KEY });
  assert.equal(spendBanner(s), null);
  assert.equal(s.balance, 10n);
  s = spendViewReducer(s, { type: 'error', message: 'No route available' });
  s = spendViewReducer(s, { type: 'context', errorKey: '1:usdc:weth', balanceKey: USDC_KEY });
  assert.equal(spendBanner(s), null);
});

test('REGRESSION banner-stays-in-same-context: re-rendering the same chain/token does not hide a real error', () => {
  let s = initialSpendView('1:eth:usdc', ETH_KEY);
  s = spendViewReducer(s, { type: 'error', message: 'No route available' });
  s = spendViewReducer(s, { type: 'context', errorKey: '1:eth:usdc', balanceKey: ETH_KEY });
  assert.equal(spendBanner(s), 'No route available');
});

test('REGRESSION balance-error-clears-on-success: a later successful read removes the balance banner', () => {
  let s = initialSpendView('1:eth:usdc', ETH_KEY);
  s = spendViewReducer(s, { type: 'balance', balanceKey: ETH_KEY, result: { balance: null, error: 'Network problem while loading your ETH balance.' } });
  assert.ok(spendBanner(s));
  s = spendViewReducer(s, { type: 'balance-loading', balanceKey: ETH_KEY });
  s = loaded(s, ETH_KEY, 5n);
  assert.equal(spendBanner(s), null);
  assert.equal(s.balance, 5n);
});

test('REGRESSION no-stale-balance: a previous token/chain balance is never reused or accepted late', () => {
  let s = initialSpendView('1:eth:usdc', ETH_KEY);
  s = loaded(s, ETH_KEY, 2_000_000_000_000_000_000n);
  // Switch to USDC: the ETH balance is dropped at once (shown as "…", pre-flight blocked).
  s = spendViewReducer(s, { type: 'context', errorKey: '1:usdc:eth', balanceKey: USDC_KEY });
  assert.equal(s.balance, null);
  assert.equal(swapBalanceGate(s.balance, s.balanceError)?.reason, 'loading');
  // The slow ETH read lands after the switch: ignored.
  s = loaded(s, ETH_KEY, 9n);
  assert.equal(s.balance, null);
  s = loaded(s, USDC_KEY, 3_000_000n);
  assert.equal(s.balance, 3_000_000n);
  assert.equal(swapBalanceGate(s.balance, s.balanceError), null);
  // Same for a chain switch.
  s = spendViewReducer(s, { type: 'context', errorKey: '8453:eth:usdc', balanceKey: BASE_ETH_KEY });
  assert.equal(s.balance, null);
});

test('REGRESSION price-guard-blocks-without-prices: no CoinGecko and no LI.FI USD values blocks the swap', () => {
  const r = checkSwapPrice({
    fromAmount: 100000000000000n, fromDecimals: 18, toAmount: 228000n, toDecimals: 6,
    fromPriceUsd: null, toPriceUsd: null, aggregatorFromUsd: null, aggregatorToUsd: null,
  });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'unverified');
  assert.match(!r.ok ? r.message : '', /blocked/);
});

test('REGRESSION price-guard-still-checks-on-fallback: LI.FI-only prices still block a bad quote', () => {
  const r = checkSwapPrice({
    fromAmount: 100000000000000n, fromDecimals: 18, toAmount: 100000n, toDecimals: 6,
    fromPriceUsd: null, toPriceUsd: null, aggregatorFromUsd: 0.23, aggregatorToUsd: 0.1,
  });
  assert.equal(!r.ok && r.reason, 'deviation');
});

test('REGRESSION reads-use-fallback: Swap/Bridge/Home balance and fee reads go through readWithFallback', async () => {
  const { readFileSync } = await import('node:fs');
  const swap = readFileSync(new URL('./swap.ts', import.meta.url), 'utf8');
  const rpcSrc = readFileSync(new URL('./rpc.ts', import.meta.url), 'utf8');
  const body = (src: string, name: string) => {
    const start = src.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    return src.slice(start, src.indexOf('\n}\n', start));
  };
  assert.match(body(swap, 'fetchTokenBalance'), /readWithFallback\(/);
  assert.doesNotMatch(body(swap, 'fetchTokenBalance'), /getProvider\(/);
  assert.match(body(rpcSrc, 'fetchBalance'), /readWithFallback\(/);
  assert.match(body(rpcSrc, 'fetchMaxFeePerGas'), /readWithFallback\(/);
});
