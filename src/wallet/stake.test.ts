import assert from 'node:assert/strict';
import test from 'node:test';

import { findStakeMarket, listStakeMarkets } from './stake';

test('lists Lido ETH and Aave V3 USDC markets', () => {
  const markets = listStakeMarkets();
  assert.ok(markets.some((market) => market.id === 'lido-eth' && market.chainId === 1));
  assert.ok(markets.some((market) => market.protocol === 'aave-v3' && market.asset.symbol === 'USDC'));
  assert.equal(findStakeMarket('lido-eth')?.title, 'Lido stETH');
  assert.equal(findStakeMarket('missing'), undefined);
});
