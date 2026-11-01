import assert from 'node:assert/strict';
import test from 'node:test';

import { makeError } from 'ethers';

import { classifyTxError, friendlyTxError, isPlainMessage, needGasMessage, toUserError, UserFacingError } from './tx-errors';

const RAW_INSUFFICIENT =
  'insufficient funds for intrinsic transaction cost (transaction="0x02f8b18189808506fc23ac008506fc23ac0083030d4094794a61358d6845594f94dc1db02a252b5b4814ad80b844617ba037", info={ "error": { "code": -32000, "message": "insufficient funds for gas * price + value" } }, code=INSUFFICIENT_FUNDS, version=6.17.0)';

function ethersError(code: Parameters<typeof makeError>[1], message: string) {
  return makeError(message, code, {} as never);
}

test('the exact error from Patrick’s Polygon Aave supply becomes a short line with no hex', () => {
  const error = Object.assign(new Error(RAW_INSUFFICIENT), { code: 'INSUFFICIENT_FUNDS' });
  const message = friendlyTxError(error, { chainId: 137 });
  assert.equal(message, 'Not enough POL on Polygon for this amount plus network fees. Nothing was sent.');
  assert.doesNotMatch(message, /0x|code=|version=/);
});

test('real ethers v6 errors map to plain messages', () => {
  const cases: Array<[Parameters<typeof makeError>[1], string, RegExp]> = [
    ['INSUFFICIENT_FUNDS', 'insufficient funds', /Not enough ETH on Base/],
    ['CALL_EXCEPTION', 'execution reverted', /network rejected this transaction/],
    ['NETWORK_ERROR', 'network changed', /Network problem/],
    ['SERVER_ERROR', 'bad gateway', /Network problem/],
    ['ACTION_REJECTED', 'user rejected action', /Request cancelled/],
    ['TIMEOUT', 'timeout', /took too long/],
    ['NONCE_EXPIRED', 'nonce has already been used', /still pending/],
  ];
  for (const [code, text, expected] of cases) {
    const message = friendlyTxError(ethersError(code, text), { chainId: 8453 });
    assert.match(message, expected, code);
    assert.ok(isPlainMessage(message), `${code} -> ${message}`);
  }
});

test('nested RPC errors and wallet-style codes are found', () => {
  assert.equal(classifyTxError({ error: { message: 'insufficient funds for gas * price + value' } }), 'insufficient-funds');
  assert.equal(classifyTxError({ info: { error: { code: 4001, message: 'User denied' } } }), 'rejected');
  assert.equal(classifyTxError(new TypeError('Network request failed')), 'network');
  assert.equal(classifyTxError(new Error('execution reverted: ERC20: transfer amount exceeds balance')), 'reverted');
});

test('unknown raw dumps fall back to a plain line; plain app messages pass through', () => {
  const raw = new Error('could not coalesce error (error={ "code": -32603 }, payload={ "method": "eth_sendRawTransaction" }, code=UNKNOWN_ERROR, version=6.17.0)');
  assert.equal(friendlyTxError(raw), 'Transaction failed. Nothing was sent.');
  assert.equal(friendlyTxError(raw, { fallback: 'Swap failed.' }), 'Swap failed.');
  assert.equal(friendlyTxError(new Error('No finalized Lido withdrawals to claim.')), 'No finalized Lido withdrawals to claim.');
  assert.equal(friendlyTxError(new UserFacingError('Custom line')), 'Custom line');
  assert.equal(friendlyTxError('x'.repeat(200)), 'Transaction failed. Nothing was sent.');
});

test('toUserError keeps UserFacingError and wraps everything else', () => {
  const original = new UserFacingError('Keep me');
  assert.equal(toUserError('t', original), original);
  const wrapped = toUserError('t', ethersError('INSUFFICIENT_FUNDS', 'insufficient funds'), { chainId: 56 });
  assert.ok(wrapped instanceof UserFacingError);
  assert.match(wrapped.message, /BNB on BNB Chain/);
});

test('gas line uses each chain’s native symbol', () => {
  assert.equal(needGasMessage(137), 'You need a little POL on Polygon to pay network fees.');
  assert.equal(needGasMessage(1), 'You need a little ETH on Ethereum to pay network fees.');
  assert.equal(needGasMessage(8453), 'You need a little ETH on Base to pay network fees.');
  assert.equal(needGasMessage(42161), 'You need a little ETH on Arbitrum to pay network fees.');
  assert.equal(needGasMessage(10), 'You need a little ETH on Optimism to pay network fees.');
  assert.equal(needGasMessage(56), 'You need a little BNB on BNB Chain to pay network fees.');
  assert.equal(needGasMessage(43114), 'You need a little AVAX on Avalanche to pay network fees.');
});
