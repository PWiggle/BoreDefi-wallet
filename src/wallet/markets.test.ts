import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionsForMarket,
  COINGECKO_HEADERS,
  COINGECKO_SITE,
  coinGeckoUrl,
  geckoIdForNative,
  geckoIdForToken,
  hydrateMarkets,
  parseCoinGeckoCoinId,
  parseCoinPage,
  parseMarkets,
  parseSearch,
  parseTrending,
  portfolioTokensForChain,
  rankGainers,
  usdValueFromUnits,
} from './markets';
import { tokensForChain } from './tokens';

test('parses CoinGecko trending, markets, and search payloads', () => {
  const trending = parseTrending({
    coins: [
      {
        item: {
          id: 'ethereum',
          symbol: 'eth',
          name: 'Ethereum',
          market_cap_rank: 2,
          large: 'https://example.com/eth.png',
          data: { price: 2400, price_change_percentage_24h: { usd: 1.5 } },
        },
      },
      { item: { id: 'skip-me' } },
    ],
  });
  assert.equal(trending.length, 1);
  assert.equal(trending[0]?.id, 'ethereum');
  assert.equal(trending[0]?.priceUsd, 2400);
  assert.equal(trending[0]?.imageUrl, 'https://example.com/eth.png');

  const markets = parseMarkets([
    {
      id: 'usd-coin',
      symbol: 'usdc',
      name: 'USDC',
      current_price: 1,
      market_cap: 70_000_000_000,
      total_volume: 8_000_000_000,
      price_change_percentage_24h: 0.01,
      market_cap_rank: 6,
      image: 'https://example.com/usdc.png',
      sparkline_in_7d: { price: [1, 1.01, 0.99, 1] },
    },
  ]);
  assert.equal(markets[0]?.volume24h, 8_000_000_000);
  assert.equal(markets[0]?.imageUrl, 'https://example.com/usdc.png');
  assert.deepEqual(markets[0]?.sparkline, [1, 1.01, 0.99, 1]);

  const search = parseSearch({
    coins: [{ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', market_cap_rank: 2 }],
  });
  assert.equal(search[0]?.symbol, 'ETH');
});

test('maps known coins onto send, swap, and stake', () => {
  const eth = actionsForMarket(
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', priceUsd: 1, marketCap: 1, volume24h: 1, change24h: 0, rank: 2, imageUrl: null, sparkline: [] },
    8453,
  );
  assert.equal(eth.send, true);
  assert.equal(eth.sendChainId, 1);
  assert.equal(eth.swap, true);
  assert.equal(eth.stakeMarketId, 'lido-eth');

  const usdc = actionsForMarket(
    { id: 'usd-coin', symbol: 'USDC', name: 'USDC', priceUsd: 1, marketCap: 1, volume24h: 1, change24h: 0, rank: 6, imageUrl: null, sparkline: [] },
    8453,
  );
  assert.equal(usdc.swapSymbol, 'USDC');
  assert.equal(usdc.stakeMarketId, 'aave-usdc-8453');

  const dog = actionsForMarket(
    { id: 'bonk', symbol: 'BONK', name: 'Bonk', priceUsd: 1, marketCap: 1, volume24h: 1, change24h: 0, rank: 50, imageUrl: null, sparkline: [] },
    1,
  );
  assert.equal(dog.send, false);
  assert.equal(dog.swap, false);
  assert.equal(dog.stake, false);
});

test('does not set a custom User-Agent for CoinGecko browser fetch', () => {
  assert.deepEqual(COINGECKO_HEADERS, { Accept: 'application/json' });
  assert.equal('User-Agent' in COINGECKO_HEADERS, false);
});

test('maps native and stables onto CoinGecko ids and portfolio rows', () => {
  assert.equal(geckoIdForNative(1), 'ethereum');
  assert.equal(geckoIdForNative(8453), 'ethereum');
  assert.equal(geckoIdForNative(137), 'polygon-ecosystem-token');
  assert.equal(geckoIdForNative(56), 'binancecoin');
  assert.equal(geckoIdForNative(43114), 'avalanche-2');

  const eth = tokensForChain(1).find((item) => item.native);
  const usdc = tokensForChain(1).find((item) => item.symbol === 'USDC');
  const usdt = tokensForChain(8453).find((item) => item.symbol === 'USDT');
  assert.equal(eth && geckoIdForToken(eth), 'ethereum');
  assert.equal(usdc && geckoIdForToken(usdc), 'usd-coin');
  assert.equal(usdt && geckoIdForToken(usdt), 'tether');

  const rows = portfolioTokensForChain(1);
  assert.deepEqual(
    rows.map((item) => item.symbol),
    ['ETH', 'WETH', 'USDC', 'USDT', 'stETH', 'APE'],
  );
  assert.equal(usdValueFromUnits(0n, 18, 3500), 0);
  assert.equal(usdValueFromUnits(500000n, 6, 1), 0.5);
  assert.equal(usdValueFromUnits(1000000000000000000n, 18, 3500), 3500);
  assert.equal(usdValueFromUnits(0n, 18, null), null);
});

test('builds CoinGecko coin URLs and ranks gainers from live rows', () => {
  assert.equal(coinGeckoUrl(), COINGECKO_SITE);
  assert.equal(coinGeckoUrl('ethereum'), 'https://www.coingecko.com/en/coins/ethereum');
  assert.equal(parseCoinGeckoCoinId('https://www.coingecko.com/en/coins/usd-coin'), 'usd-coin');
  assert.equal(parseCoinGeckoCoinId('https://app.uniswap.org'), null);

  const gainers = rankGainers([
    { id: 'down', symbol: 'D', name: 'Down', priceUsd: 1, marketCap: 1, volume24h: 1, change24h: -3, rank: 2, imageUrl: null, sparkline: [] },
    { id: 'up', symbol: 'U', name: 'Up', priceUsd: 1, marketCap: 1, volume24h: 1, change24h: 12, rank: 3, imageUrl: null, sparkline: [] },
    { id: 'flat', symbol: 'F', name: 'Flat', priceUsd: 1, marketCap: 1, volume24h: 1, change24h: null, rank: 4, imageUrl: null, sparkline: [] },
  ]);
  assert.deepEqual(gainers.map((item) => item.id), ['up', 'down']);

  const hydrated = hydrateMarkets(
    [{ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', priceUsd: null, marketCap: null, volume24h: null, change24h: null, rank: 2, imageUrl: null, sparkline: [] }],
    [{ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', priceUsd: 2400, marketCap: 1, volume24h: 1, change24h: 1.5, rank: 2, imageUrl: 'https://example.com/eth.png', sparkline: [1, 2] }],
  );
  assert.equal(hydrated[0]?.priceUsd, 2400);
  assert.deepEqual(hydrated[0]?.sparkline, [1, 2]);

  const page = parseCoinPage({
    id: 'ethereum',
    symbol: 'eth',
    name: 'Ethereum',
    image: { large: 'https://example.com/eth.png' },
    description: { en: '<p>Smart contracts.</p>' },
    links: { homepage: ['https://ethereum.org'] },
    market_cap_rank: 2,
    market_data: {
      current_price: { usd: 2400 },
      price_change_percentage_24h: 1.5,
      market_cap: { usd: 280_000_000_000 },
      total_volume: { usd: 10_000_000_000 },
      sparkline_7d: { price: [2300, 2400] },
    },
  });
  assert.equal(page.description, 'Smart contracts.');
  assert.equal(page.homepage, 'https://ethereum.org');
  assert.deepEqual(page.sparkline, [2300, 2400]);
});

import {
  BOREDASH_API_BASE,
  BOREDASH_API_ENABLED,
  BOREDASH_BODY_TIMEOUT_MS,
  BOREDASH_TIMEOUT_MS,
  boreDashUrl,
  fetchCoinPage,
  fetchMarketDetails,
  fetchMarketJson,
  fetchTopMarkets,
  fetchTrendingCoins,
  fetchUsdPrices,
  MARKET_ROUTES,
  marketUrls,
  searchMarkets,
  isCoinGeckoUrl,
  marketBases,
} from './markets';

test('BoreDash coin pages: taps open boredash.com/coins/<id>', () => {
  assert.equal(boreDashUrl(), 'https://www.boredash.com');
  assert.equal(boreDashUrl('ethereum'), 'https://www.boredash.com/coins/ethereum');
  assert.equal(boreDashUrl('usd coin'), 'https://www.boredash.com/coins/usd%20coin');
  assert.equal(parseCoinGeckoCoinId('https://www.boredash.com/coins/usd-coin'), 'usd-coin');
  assert.equal(isCoinGeckoUrl('https://www.boredash.com/coins/bitcoin'), true);
  assert.equal(isCoinGeckoUrl('https://www.boredash.com/about'), false);
});

test('BoreDash enabled: BoreDash first, CoinGecko fallback on error or headers timeout', async () => {
  assert.deepEqual(marketBases(true), [BOREDASH_API_BASE, 'https://api.coingecko.com/api/v3']);
  const ok = await fetchMarketJson<string>('/x', {
    enabled: true,
    fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => url }),
  });
  assert.equal(ok, `${BOREDASH_API_BASE}/x`);

  const calls: string[] = [];
  const fell = await fetchMarketJson<string>('/x', {
    enabled: true,
    fetchImpl: async (url) => {
      calls.push(url);
      return url.startsWith(BOREDASH_API_BASE)
        ? { ok: false, status: 404, json: async () => null }
        : { ok: true, status: 200, json: async () => 'gecko' };
    },
  });
  assert.equal(fell, 'gecko');
  assert.equal(calls.length, 2);

  const started = Date.now();
  const timedOut = await fetchMarketJson<string>('/x', {
    enabled: true,
    timeoutMs: 50,
    fetchImpl: (url, init) =>
      url.startsWith(BOREDASH_API_BASE)
        ? new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
        : Promise.resolve({ ok: true, status: 200, json: async () => 'gecko' }),
  });
  assert.equal(timedOut, 'gecko');
  assert.ok(Date.now() - started < 1000);

  await assert.rejects(
    fetchMarketJson('/x', { enabled: true, fetchImpl: async () => ({ ok: false, status: 503, json: async () => null }) }),
    /HTTP 503/,
  );
});

// ---- Phase B: BoreDash live, CoinGecko fallback ----

type Hit = { url: string };
function mockFetch(handler: (url: string, init?: { signal?: AbortSignal }) => Promise<unknown> | unknown) {
  const calls: Hit[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { signal?: AbortSignal }) => {
    calls.push({ url: String(url) });
    const out = await handler(String(url), init);
    if (out instanceof Error) throw out;
    if (typeof out === 'number') return { ok: false, status: out, json: async () => null };
    return { ok: true, status: 200, json: async () => out };
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const marketRow = (id: string) => ({ id, symbol: id.slice(0, 3), name: id, current_price: 1, market_cap: 10, market_cap_rank: 1, total_volume: 5, price_change_percentage_24h: 1, image: 'https://x/y.png', sparkline_in_7d: { price: [1, 2, 3] } });

test('Phase B: BoreDash is on and each call maps to its BoreDash route', () => {
  assert.equal(BOREDASH_API_ENABLED, true);
  assert.equal(BOREDASH_API_BASE, 'https://www.boredash.com');
  assert.equal(marketUrls(MARKET_ROUTES.top(100))[0], 'https://www.boredash.com/api/wallet/top?limit=100&sparkline=true');
  assert.equal(marketUrls(MARKET_ROUTES.details(['bitcoin', 'ethereum']))[0], 'https://www.boredash.com/api/markets?ids=bitcoin%2Cethereum&sparkline=true');
  assert.equal(marketUrls(MARKET_ROUTES.trending())[0], 'https://www.boredash.com/api/wallet/trending');
  assert.equal(marketUrls(MARKET_ROUTES.search('eth usd'))[0], 'https://www.boredash.com/api/search?q=eth%20usd');
  assert.equal(marketUrls(MARKET_ROUTES.coin('usd-coin'))[0], 'https://www.boredash.com/api/wallet/coin/usd-coin');
  for (const route of [MARKET_ROUTES.top(100), MARKET_ROUTES.details(['x']), MARKET_ROUTES.trending(), MARKET_ROUTES.search('x'), MARKET_ROUTES.coin('x')]) {
    const urls = marketUrls(route);
    assert.equal(urls.length, 2);
    assert.ok(urls[1]!.startsWith('https://api.coingecko.com/api/v3/'));
  }
});

test('Phase B: the swap/bridge price guard (fetchUsdPrices) never calls BoreDash', async () => {
  assert.deepEqual(marketUrls(MARKET_ROUTES.usdPrices(['ethereum'])), ['https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd']);
  const m = mockFetch(() => ({ ethereum: { usd: 2260 } }));
  try {
    assert.deepEqual(await fetchUsdPrices(['ethereum']), { ethereum: 2260 });
    assert.equal(m.calls.length, 1);
    assert.ok(m.calls[0]!.url.startsWith('https://api.coingecko.com/'));
  } finally { m.restore(); }
});

test('Phase B: top, details, trending, search and coin load from BoreDash when it answers', async () => {
  const m = mockFetch((url) => {
    assert.ok(url.startsWith('https://www.boredash.com/'), url);
    if (url.includes('/api/wallet/top') || url.includes('/api/markets')) return [marketRow('bitcoin'), marketRow('ethereum')];
    if (url.includes('/api/wallet/trending')) return { coins: [{ item: { id: 'pepe', symbol: 'PEPE', name: 'Pepe', market_cap_rank: 30, thumb: 'https://x', data: { price: 0.00001 } } }] };
    if (url.includes('/api/search')) return { coins: [{ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', market_cap_rank: 2, thumb: 'https://x' }] };
    if (url.includes('/api/wallet/coin/')) return { id: 'ethereum', symbol: 'eth', name: 'Ethereum', market_cap_rank: 2, description: { en: 'Hi' }, market_data: { current_price: { usd: 2260 } } };
    throw new Error('unexpected ' + url);
  });
  try {
    assert.equal((await fetchTopMarkets(100)).length, 2);
    assert.equal((await fetchMarketDetails(['bitcoin'])).length, 2);
    assert.equal((await fetchTrendingCoins())[0]!.id, 'pepe');
    assert.equal((await searchMarkets('eth'))[0]!.id, 'ethereum');
    assert.equal((await fetchCoinPage('ethereum')).priceUsd, 2260);
    assert.equal(m.calls.length, 5);
  } finally { m.restore(); }
});

test('Phase B: BoreDash error, non-JSON-shaped or empty list falls back to CoinGecko', async () => {
  const cases: Array<[string, unknown]> = [['5xx', 502], ['network', new Error('offline')], ['bad shape', { nope: true }], ['empty top list', []]];
  for (const [label, bad] of cases) {
    const m = mockFetch((url) => (url.startsWith('https://www.boredash.com/') ? bad : [marketRow('bitcoin')]));
    try {
      const out = await fetchTopMarkets(100);
      assert.equal(out[0]!.id, 'bitcoin', label);
      assert.equal(m.calls.length, 2, label);
      assert.ok(m.calls[1]!.url.startsWith('https://api.coingecko.com/api/v3/coins/markets'), label);
    } finally { m.restore(); }
  }
  const m = mockFetch((url) => (url.includes('boredash') ? 404 : { id: 'ethereum', symbol: 'eth', name: 'Ethereum', market_data: { current_price: { usd: 1 } } }));
  try {
    assert.equal((await fetchCoinPage('ethereum')).id, 'ethereum');
    assert.ok(m.calls[1]!.url.startsWith('https://api.coingecko.com/api/v3/coins/ethereum?'));
  } finally { m.restore(); }
});

test('Phase B: a hung BoreDash call is aborted after the timeout and CoinGecko answers', async () => {
  const started = Date.now();
  const out = await fetchMarketJson<string>(MARKET_ROUTES.trending(), {
    timeoutMs: 40,
    fetchImpl: (url, init) =>
      url.startsWith(BOREDASH_API_BASE)
        ? new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
        : Promise.resolve({ ok: true, status: 200, json: async () => 'gecko' }),
  });
  assert.equal(out, 'gecko');
  assert.ok(Date.now() - started < 1000);
});

test('Phase B: both sources down surfaces a plain error', async () => {
  const m = mockFetch(() => 503);
  try {
    await assert.rejects(fetchTopMarkets(100), /Could not load market stats/);
  } finally { m.restore(); }
});

// ---- BoreDash timeouts: headers vs body ----

test('BoreDash limits: 6s for headers, 15s for the body', () => {
  assert.equal(BOREDASH_TIMEOUT_MS, 6_000);
  assert.equal(BOREDASH_BODY_TIMEOUT_MS, 15_000);
});

test('BoreDash: a slow body after fast headers is NOT cut off by the headers timeout', async () => {
  const calls: string[] = [];
  const out = await fetchMarketJson<string>('/x', {
    enabled: true,
    timeoutMs: 30,
    bodyTimeoutMs: 1_000,
    fetchImpl: async (url, init) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((resolve, reject) => {
            const t = setTimeout(() => resolve('boredash'), 120); // well past the 30 ms headers limit
            init?.signal?.addEventListener('abort', () => {
              clearTimeout(t);
              reject(new Error('aborted'));
            });
          }),
      };
    },
  });
  assert.equal(out, 'boredash');
  assert.deepEqual(calls, [`${BOREDASH_API_BASE}/x`]);
});

test('BoreDash: a body that exceeds the body limit falls back to CoinGecko', async () => {
  const started = Date.now();
  const out = await fetchMarketJson<string>('/x', {
    enabled: true,
    timeoutMs: 1_000,
    bodyTimeoutMs: 40,
    fetchImpl: async (url, init) =>
      url.startsWith(BOREDASH_API_BASE)
        ? {
            ok: true,
            status: 200,
            json: () =>
              new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
          }
        : { ok: true, status: 200, json: async () => 'gecko' },
  });
  assert.equal(out, 'gecko');
  assert.ok(Date.now() - started < 1_000);
});

test('BoreDash: an aborted stream that still resolves (truncated) is treated as a failure', async () => {
  const out = await fetchMarketJson<string>('/x', {
    enabled: true,
    timeoutMs: 1_000,
    bodyTimeoutMs: 30,
    fetchImpl: async (url) =>
      url.startsWith(BOREDASH_API_BASE)
        ? { ok: true, status: 200, json: () => new Promise((resolve) => setTimeout(() => resolve('partial'), 90)) }
        : { ok: true, status: 200, json: async () => 'gecko' },
  });
  assert.equal(out, 'gecko');
});

test('BoreDash: truncated JSON or a payload that does not parse falls back to CoinGecko', async () => {
  const truncated = await fetchMarketJson<string>('/x', {
    enabled: true,
    fetchImpl: async (url) =>
      url.startsWith(BOREDASH_API_BASE)
        ? { ok: true, status: 200, json: async () => JSON.parse('[{"id":"bitc') }
        : { ok: true, status: 200, json: async () => 'gecko' },
  });
  assert.equal(truncated, 'gecko');

  const badShape = await fetchMarketJson<unknown, string>('/x', {
    enabled: true,
    parse: (payload) => {
      if (payload !== 'gecko-shape') {
        throw new Error('bad shape');
      }
      return 'parsed';
    },
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      json: async () => (url.startsWith(BOREDASH_API_BASE) ? { nope: true } : 'gecko-shape'),
    }),
  });
  assert.equal(badShape, 'parsed');
});
