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

import { checkStakePreflight, stakeGasUnits, stakeSpend, type StakeAction } from './stake';
import { GAS_UNITS } from './preflight';
import { CHAINS } from './chains';

const GWEI = 1_000_000_000n;
const ACTIONS: StakeAction[] = ['stake', 'unstake'];

test('covers every Stake option: Lido on Ethereum and Aave V3 USDC on every configured chain', () => {
  const ids = listStakeMarkets().map((market) => market.id).sort();
  assert.deepEqual(ids, [
    'aave-usdc-1',
    'aave-usdc-10',
    'aave-usdc-137',
    'aave-usdc-42161',
    'aave-usdc-43114',
    'aave-usdc-8453',
    'lido-eth',
  ]);
});

for (const market of listStakeMarkets()) {
  const symbol = CHAINS[market.chainId].symbol;
  const chainName = CHAINS[market.chainId].name;
  const one = 10n ** BigInt(market.asset.decimals);

  for (const action of ACTIONS) {
    const label = `${market.id} ${action}`;
    const ready = {
      market,
      action,
      amount: one,
      walletBalance: one * 10n,
      positionBalance: one * 10n,
      nativeBalance: 10n ** 18n * 10n,
      maxFeePerGas: 30n * GWEI,
    };

    test(`${label}: passes with token, position and gas`, () => {
      assert.deepEqual(checkStakePreflight(ready), { ok: true });
    });

    test(`${label}: zero amount is disabled`, () => {
      const result = checkStakePreflight({ ...ready, amount: 0n });
      assert.equal(!result.ok && result.reason, 'amount-missing');
    });

    test(`${label}: amount above the spent balance is disabled`, () => {
      const result =
        action === 'stake'
          ? checkStakePreflight({ ...ready, walletBalance: one - 1n, nativeBalance: stakeSpend(market, action).native ? one - 1n : ready.nativeBalance })
          : checkStakePreflight({ ...ready, positionBalance: one - 1n });
      assert.equal(!result.ok && result.reason, 'amount-too-high');
      assert.match(!result.ok ? result.message : '', new RegExp(`your ${stakeSpend(market, action).symbol} balance`));
    });

    test(`${label}: zero ${symbol} for gas shows the ${symbol} line`, () => {
      const result = checkStakePreflight({
        ...ready,
        nativeBalance: 0n,
        walletBalance: stakeSpend(market, action).native ? 0n : ready.walletBalance,
        amount: stakeSpend(market, action).native ? null : one,
      });
      if (stakeSpend(market, action).native) {
        // Lido stake spends ETH itself: 0 ETH means the amount check trips first, which is still blocked.
        assert.equal(result.ok, false);
      } else {
        assert.deepEqual(result, {
          ok: false,
          reason: 'no-gas',
          message: `You need a little ${symbol} on ${chainName} to pay network fees.`,
        });
      }
    });

    test(`${label}: gas below the estimated fee (approve included) is disabled`, () => {
      const units = stakeGasUnits(market, action, true);
      const fee = units * ready.maxFeePerGas;
      const nativeSpend = stakeSpend(market, action).native ? one : 0n;
      const result = checkStakePreflight({
        ...ready,
        walletBalance: stakeSpend(market, action).native ? one : ready.walletBalance,
        nativeBalance: nativeSpend + fee - 1n,
      });
      assert.equal(!result.ok && result.reason, 'gas-too-low');
    });
  }
}

test('Patrick’s Polygon Aave supply with 0 USDC and 0 POL never reaches a transaction', () => {
  const market = findStakeMarket('aave-usdc-137')!;
  const result = checkStakePreflight({
    market,
    action: 'stake',
    amount: 1_000_000n,
    walletBalance: 0n,
    positionBalance: 0n,
    nativeBalance: 0n,
    maxFeePerGas: 50n * GWEI,
  });
  assert.equal(result.ok, false);
});

test('Lido claim only needs gas', () => {
  const market = findStakeMarket('lido-eth')!;
  const base = { market, action: 'claim' as const, amount: null, walletBalance: 0n, positionBalance: 0n, maxFeePerGas: 20n * GWEI };
  assert.equal(checkStakePreflight({ ...base, nativeBalance: 10n ** 17n }).ok, true);
  assert.deepEqual(checkStakePreflight({ ...base, nativeBalance: 0n }), {
    ok: false,
    reason: 'no-gas',
    message: 'You need a little ETH on Ethereum to pay network fees.',
  });
});

test('gas units include the approve step where one may be needed', () => {
  const aave = findStakeMarket('aave-usdc-8453')!;
  const lido = findStakeMarket('lido-eth')!;
  assert.equal(stakeGasUnits(aave, 'stake', true), GAS_UNITS.aaveSupply + GAS_UNITS.erc20Approve);
  assert.equal(stakeGasUnits(aave, 'stake', false), GAS_UNITS.aaveSupply);
  assert.equal(stakeGasUnits(aave, 'unstake'), GAS_UNITS.aaveWithdraw);
  assert.equal(stakeGasUnits(lido, 'stake'), GAS_UNITS.lidoStake);
  assert.equal(stakeGasUnits(lido, 'unstake', true), GAS_UNITS.lidoUnstake + GAS_UNITS.erc20Approve);
  assert.equal(stakeGasUnits(lido, 'claim'), GAS_UNITS.lidoClaim);
});

test('spent balance per action', () => {
  const aave = findStakeMarket('aave-usdc-137')!;
  const lido = findStakeMarket('lido-eth')!;
  assert.deepEqual(stakeSpend(lido, 'stake'), { source: 'wallet', symbol: 'ETH', native: true });
  assert.deepEqual(stakeSpend(lido, 'unstake'), { source: 'position', symbol: 'stETH', native: false });
  assert.deepEqual(stakeSpend(aave, 'stake'), { source: 'wallet', symbol: 'USDC', native: false });
  assert.deepEqual(stakeSpend(aave, 'unstake'), { source: 'position', symbol: 'aUSDC', native: false });
});
