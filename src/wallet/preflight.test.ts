import assert from 'node:assert/strict';
import test from 'node:test';

import { checkPreflight, estimateFeeWei, GAS_UNITS, preflightLine, type PreflightInput } from './preflight';

const GWEI = 1_000_000_000n;
const base: PreflightInput = {
  chainId: 137,
  amount: 1_000_000n,
  spendBalance: 5_000_000n,
  spendSymbol: 'USDC',
  nativeBalance: 10n ** 18n,
  feeWei: 100n * GWEI * 400_000n,
  spendIsNative: false,
};

test('blocks zero, negative (unparseable) and missing amounts', () => {
  for (const amount of [0n, -1n]) {
    const result = checkPreflight({ ...base, amount });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'amount-missing');
  }
});

test('blocks an amount above the token balance', () => {
  const result = checkPreflight({ ...base, amount: 6_000_000n });
  assert.deepEqual(result, { ok: false, reason: 'amount-too-high', message: 'That is more than your USDC balance.' });
});

test('Patrick’s case: 0 USDC and 0 POL is blocked before any transaction', () => {
  const result = checkPreflight({ ...base, spendBalance: 0n, nativeBalance: 0n });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'amount-too-high');
  const withUsdc = checkPreflight({ ...base, nativeBalance: 0n });
  assert.deepEqual(withUsdc, {
    ok: false,
    reason: 'no-gas',
    message: 'You need a little POL on Polygon to pay network fees.',
  });
});

test('blocks when gas balance is below the estimated fee', () => {
  const result = checkPreflight({ ...base, nativeBalance: 1n });
  assert.equal(!result.ok && result.reason, 'gas-too-low');
  assert.equal(!result.ok && result.message, 'You need a little POL on Polygon to pay network fees.');
});

test('native spends must leave room for the fee', () => {
  const nativeCase: PreflightInput = {
    ...base,
    chainId: 1,
    spendSymbol: 'ETH',
    spendIsNative: true,
    amount: 10n ** 18n,
    spendBalance: 10n ** 18n,
    nativeBalance: 10n ** 18n,
    feeWei: 21_000n * 20n * GWEI,
  };
  const result = checkPreflight(nativeCase);
  assert.equal(!result.ok && result.reason, 'gas-too-low');
  assert.match(!result.ok ? result.message : '', /Leave some ETH for network fees/);
  assert.equal(checkPreflight({ ...nativeCase, amount: 10n ** 17n }).ok, true);
});

test('still waiting for balances keeps the action disabled', () => {
  const result = checkPreflight({ ...base, nativeBalance: null });
  assert.equal(!result.ok && result.reason, 'loading');
});

test('unknown fee only requires a non-zero gas balance', () => {
  assert.equal(checkPreflight({ ...base, feeWei: null, nativeBalance: 1n }).ok, true);
});

test('no-amount actions (claim) only check gas', () => {
  assert.equal(checkPreflight({ ...base, amount: null, spendBalance: 0n }).ok, true);
  assert.equal(checkPreflight({ ...base, amount: null, nativeBalance: 0n }).ok, false);
});

test('fee estimate pads L2s that add an L1 data fee', () => {
  assert.equal(estimateFeeWei(1, GAS_UNITS.nativeTransfer, 10n), 210_000n);
  assert.equal(estimateFeeWei(8453, GAS_UNITS.nativeTransfer, 10n), 420_000n);
  assert.equal(estimateFeeWei(137, GAS_UNITS.nativeTransfer, 10n), 210_000n);
});

test('preflightLine always shows gas problems and amount problems only after typing', () => {
  const noGas = checkPreflight({ ...base, amount: 0n, nativeBalance: 0n });
  // amount-missing wins inside checkPreflight, so build the gas result directly
  const gas = checkPreflight({ ...base, nativeBalance: 0n });
  const tooHigh = checkPreflight({ ...base, amount: 9_000_000n });
  assert.equal(preflightLine([noGas], false), null);
  assert.equal(preflightLine([tooHigh, gas], false), 'You need a little POL on Polygon to pay network fees.');
  assert.equal(preflightLine([tooHigh], false), null);
  assert.equal(preflightLine([tooHigh], true), 'That is more than your USDC balance.');
  assert.equal(preflightLine([checkPreflight(base)], true), null);
});
