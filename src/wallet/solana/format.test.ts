import assert from 'node:assert/strict';
import test from 'node:test';

import { formatSol, formatSolanaAmount } from './format';

test('SOL shows every significant lamport, trimmed', () => {
  assert.equal(formatSol(20_821_639n), '0.020821639');
  assert.equal(formatSol(15_816_639n), '0.015816639');
  assert.equal(formatSol(5_000_000n), '0.005');
  assert.equal(formatSol(0n), '0');
  assert.equal(formatSol(1n), '0.000000001');
  assert.equal(formatSol(1_234_500_000_000n), '1,234.5');
});

test('tokens use their own decimals, capped at 9, with thousands separators', () => {
  assert.equal(formatSolanaAmount(2_500_000n, 6), '2.5');
  assert.equal(formatSolanaAmount(834_694_675_459_207_006n, 5), '8,346,946,754,592.07006');
  assert.equal(formatSolanaAmount(42n, 0), '42');
  assert.equal(formatSolanaAmount(1n, 12), '0');
  assert.equal(formatSolanaAmount(-5n, 1), '-0.5');
});
