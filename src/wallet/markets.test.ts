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
    ['ETH', 'USDC', 'USDT'],
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
  boreDashUrl,
  fetchMarketJson,
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

test('BoreDash API is off by default: only CoinGecko is called', async () => {
  assert.equal(BOREDASH_API_ENABLED, false);
  assert.deepEqual(marketBases(), ['https://api.coingecko.com/api/v3']);
  const calls: string[] = [];
  const out = await fetchMarketJson<{ a: number }>('/ping', {
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ a: 1 }) };
    },
  });
  assert.deepEqual(out, { a: 1 });
  assert.deepEqual(calls, ['https://api.coingecko.com/api/v3/ping']);
});

test('BoreDash enabled: BoreDash first, CoinGecko fallback on error or 4s timeout', async () => {
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
