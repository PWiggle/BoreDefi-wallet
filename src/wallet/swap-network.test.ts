import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { FallbackProvider, JsonRpcProvider } from 'ethers';

import { fetchUsdPrices } from './markets';
import { readWithFallback, RPC_PROVIDER_OPTIONS } from './rpc';
import { fetchSwapQuote, fetchWithRetry, SWAP_STEPS } from './swap';
import { checkSwapPrice, swapBalanceGate, UNVERIFIED_PRICE_MESSAGE } from './swap-guard';
import { tokensForChain } from './tokens';
import { friendlyTxError } from './tx-errors';

const OWNER = '0xd8da6bf26964af9d7eed9e604bca6ca4cbfc7a6e';

/** Local JSON-RPC endpoint. `fail` answers HTTP 500 (like drpc's batch limit or a 5xx) to everything but eth_blockNumber. */
async function rpcServer(mode: 'ok' | 'fail'): Promise<{ url: string; hits: { batch: boolean }[]; close: () => Promise<void> }> {
  const hits: { batch: boolean }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const parsed = JSON.parse(body) as { id: number; method: string } | { id: number; method: string }[];
      const list = Array.isArray(parsed) ? parsed : [parsed];
      hits.push({ batch: Array.isArray(parsed) });
      if (mode === 'fail' && list.some((item) => item.method !== 'eth_blockNumber')) {
        res.statusCode = 500;
        res.end('{"error":"boom"}');
        return;
      }
      const answer = (item: { id: number; method: string }) => ({
        jsonrpc: '2.0',
        id: item.id,
        result: item.method === 'eth_blockNumber' ? '0x10' : '0x2a',
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(Array.isArray(parsed) ? list.map(answer) : answer(list[0]!)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('root cause: FallbackProvider (quorum 1) throws one backend error as "Network problem"; readWithFallback recovers', async () => {
  const bad = await rpcServer('fail');
  const good = await rpcServer('ok');
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
    // What build 11 did: one 500 from the first RPC fails the read even though the second RPC is healthy.
    await assert.rejects(fallback.getBalance(OWNER), (error: unknown) => {
      assert.equal(friendlyTxError(error), 'Network problem. Check your connection and try again.');
      return true;
    });
    // The fix: the same read falls through to the healthy endpoint.
    assert.equal(await readWithFallback(1, (p) => p.getBalance(OWNER), [fallback, badP, goodP]), 42n);
  } finally {
    fallback.destroy();
    badP.destroy();
    goodP.destroy();
    await bad.close();
    await good.close();
  }
});

test('RPC providers send one request per HTTP call (no JSON-RPC batches for free public RPCs)', async () => {
  assert.equal(RPC_PROVIDER_OPTIONS.batchMaxCount, 1);
  const server = await rpcServer('ok');
  const provider = new JsonRpcProvider(server.url, 1, RPC_PROVIDER_OPTIONS);
  try {
    const owners = ['0x1', '0x2', '0x3', '0x4'].map((n) => `0x${n.slice(2).padStart(40, '0')}`);
    await Promise.all(owners.map((owner) => provider.getBalance(owner)));
    assert.ok(server.hits.length >= 4);
    assert.ok(server.hits.every((hit) => !hit.batch));
  } finally {
    provider.destroy();
    await server.close();
  }
});

test('readWithFallback: a hanging endpoint times out and the next one answers', async () => {
  const hang = { name: 'hang' };
  const ok = { name: 'ok' };
  const value = await readWithFallback(
    1,
    (p) => ((p as unknown as { name: string }).name === 'hang' ? new Promise<bigint>(() => {}) : Promise.resolve(7n)),
    [hang, ok] as never,
    30,
  );
  assert.equal(value, 7n);
});

test('error messages name the failing step', () => {
  const network = Object.assign(new Error('Network request failed'), {});
  assert.equal(
    friendlyTxError(network, { step: SWAP_STEPS.balance('ETH') }),
    'Network problem while loading your ETH balance. Check your connection and try again.',
  );
  assert.equal(
    friendlyTxError(network, { step: SWAP_STEPS.quote }),
    'Network problem while getting a swap quote from LI.FI. Check your connection and try again.',
  );
  assert.equal(
    friendlyTxError(Object.assign(new Error('x'), { code: 'TIMEOUT' }), { step: SWAP_STEPS.quote }),
    'The network took too long while getting a swap quote from LI.FI. Try again in a moment.',
  );
  // Without a step the old wording stays (Send, Stake, …).
  assert.equal(friendlyTxError(network), 'Network problem. Check your connection and try again.');
  // Non-network errors are unchanged by a step.
  assert.equal(friendlyTxError(new Error('user rejected'), { step: SWAP_STEPS.quote }), 'Request cancelled. Nothing was sent.');
});

function mockGlobalFetch(handler: (url: string) => unknown) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    const out = await handler(String(url));
    if (out instanceof Error) throw out;
    if (typeof out === 'number') return { ok: false, status: out, json: async () => ({ message: 'busy' }) };
    return { ok: true, status: 200, json: async () => out };
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const [ETH, WETH, USDC] = (() => {
  const list = tokensForChain(1);
  return [list.find((t) => t.native)!, list.find((t) => t.symbol === 'WETH')!, list.find((t) => t.symbol === 'USDC')!];
})();

const liFiQuote = {
  tool: 'sushiswap',
  toolDetails: { name: 'SushiSwap Aggregator' },
  action: {
    fromChainId: 1,
    toChainId: 1,
    fromAmount: '100000000000000',
    fromToken: { address: '0x0000000000000000000000000000000000000000', decimals: 18, symbol: 'ETH' },
    toToken: { address: USDC.address, decimals: 6, symbol: 'USDC' },
  },
  estimate: { toAmount: '228000', toAmountMin: '226000', fromAmountUSD: '0.23', toAmountUSD: '0.23' },
  includedSteps: [{ type: 'swap', tool: 'sushiswap' }],
  transactionRequest: { to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', data: '0x1234', value: '0x5af3107a4000' },
};

test('fetchSwapQuote: the exact 0.0001 ETH→USDC request; one dropped connection is retried', async () => {
  let n = 0;
  const m = mockGlobalFetch(() => (++n === 1 ? new TypeError('Network request failed') : liFiQuote));
  try {
    const quote = await fetchSwapQuote({ chainId: 1, fromToken: ETH, toToken: USDC, fromAmount: 100000000000000n, fromAddress: OWNER });
    assert.equal(quote.toAmount, 228000n);
    assert.equal(m.calls.length, 2);
    const url = new URL(m.calls[1]!);
    assert.equal(url.origin + url.pathname, 'https://li.quest/v1/quote');
    assert.equal(url.searchParams.get('fromChain'), '1');
    assert.equal(url.searchParams.get('fromAmount'), '100000000000000');
    assert.equal(url.searchParams.get('fromToken'), ETH.address);
    assert.equal(url.searchParams.get('integrator'), 'boredefi');
  } finally {
    m.restore();
  }
});

test('fetchSwapQuote: a quote that cannot be fetched says the quote step failed', async () => {
  const m = mockGlobalFetch(() => new TypeError('Network request failed'));
  try {
    await assert.rejects(
      fetchSwapQuote({ chainId: 1, fromToken: ETH, toToken: WETH, fromAmount: 1n, fromAddress: OWNER }),
      /Network problem while getting a swap quote from LI\.FI/,
    );
    assert.equal(m.calls.length, 2);
  } finally {
    m.restore();
  }
});

test('fetchWithRetry: gives up after the attempts and throws the last error', async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithRetry(async () => { calls += 1; throw new Error(`fail ${calls}`); }, { attempts: 3, sleep: async () => {} }),
    /fail 3/,
  );
  assert.equal(calls, 3);
});

test('price guard feed: CoinGecko 429 once is retried, not dropped', async () => {
  let n = 0;
  const m = mockGlobalFetch(() => (++n === 1 ? 429 : { ethereum: { usd: 2280 }, 'usd-coin': { usd: 1 } }));
  try {
    assert.deepEqual(await fetchUsdPrices(['ethereum', 'usd-coin'], { retryDelayMs: 0 }), { ethereum: 2280, 'usd-coin': 1 });
    assert.equal(m.calls.length, 2);
    assert.ok(m.calls.every((url) => url.startsWith('https://api.coingecko.com/')));
  } finally {
    m.restore();
  }
});

test('price guard: feed down falls back to LI.FI USD values; nothing at all blocks with a clear message', () => {
  const base = { fromAmount: 100000000000000n, fromDecimals: 18, toAmount: 228000n, toDecimals: 6, fromPriceUsd: null, toPriceUsd: null };
  const viaAggregator = checkSwapPrice({ ...base, aggregatorFromUsd: 0.23, aggregatorToUsd: 0.228 });
  assert.equal(viaAggregator.ok, true);
  assert.equal(viaAggregator.ok && viaAggregator.source, 'aggregator');
  const none = checkSwapPrice({ ...base, aggregatorFromUsd: null, aggregatorToUsd: null });
  assert.equal(none.ok, false);
  assert.equal(!none.ok && none.message, UNVERIFIED_PRICE_MESSAGE);
  // A bad quote is still blocked when only the fallback prices are available.
  const bad = checkSwapPrice({ ...base, aggregatorFromUsd: 0.23, aggregatorToUsd: 0.1 });
  assert.equal(!bad.ok && bad.reason, 'deviation');
});

test('swapBalanceGate: no pre-flight on an unknown balance; a loaded balance passes through', () => {
  assert.deepEqual(swapBalanceGate(null, null), { ok: false, reason: 'loading', message: 'Checking your balance…' });
  assert.equal(swapBalanceGate(null, 'Network problem while loading your ETH balance.')?.message, 'Your balance has not loaded yet.');
  assert.equal(swapBalanceGate(0n, null), null);
});
