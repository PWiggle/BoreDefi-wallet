import assert from 'node:assert/strict';
import test from 'node:test';

import { actionsForMarket, parseMarkets, parseSearch, parseTrending } from './markets';

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
