import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionsForMarket,
  COINGECKO_HEADERS,
  geckoIdForNative,
  geckoIdForToken,
  parseMarkets,
  parseSearch,
  parseTrending,
  portfolioTokensForChain,
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
          data: { price: 2400, price_change_percentage_24h: { usd: 1.5 } },
        },
      },
      { item: { id: 'skip-me' } },
    ],
  });
  assert.equal(trending.length, 1);
  assert.equal(trending[0]?.id, 'ethereum');
  assert.equal(trending[0]?.priceUsd, 2400);

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
    },
  ]);
  assert.equal(markets[0]?.volume24h, 8_000_000_000);

  const search = parseSearch({
    coins: [{ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', market_cap_rank: 2 }],
  });
  assert.equal(search[0]?.symbol, 'ETH');
});

test('maps known coins onto send, swap, and stake', () => {
  const eth = actionsForMarket(
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', priceUsd: 1, marketCap: 1, volume24h: 1, change24h: 0, rank: 2 },
    8453,
  );
  assert.equal(eth.send, true);
  assert.equal(eth.sendChainId, 1);
  assert.equal(eth.swap, true);
  assert.equal(eth.stakeMarketId, 'lido-eth');

  const usdc = actionsForMarket(
    { id: 'usd-coin', symbol: 'USDC', name: 'USDC', priceUsd: 1, marketCap: 1, volume24h: 1, change24h: 0, rank: 6 },
    8453,
  );
  assert.equal(usdc.swapSymbol, 'USDC');
  assert.equal(usdc.stakeMarketId, 'aave-usdc-8453');

  const dog = actionsForMarket(
    { id: 'bonk', symbol: 'BONK', name: 'Bonk', priceUsd: 1, marketCap: 1, volume24h: 1, change24h: 0, rank: 50 },
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
  assert.equal(geckoIdForNative(137), 'matic-network');
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
