import assert from 'node:assert/strict';
import test from 'node:test';

import { solanaActivityHiddenReason, splitSolanaActivity, type SolanaActivityItem } from './activity';

const row = (o: Partial<SolanaActivityItem>): SolanaActivityItem => ({
  signature: Math.random().toString(36), blockTime: 1, status: 'confirmed', direction: 'in', symbol: 'SOL', decimals: 9,
  amount: 50_000_000n, feeLamports: 0n, counterparty: null, explorerUrl: 'https://solscan.io/tx/x', ...o,
});

test('spam, dust and all failed txs are hidden; own successful actions always show', () => {
  assert.ok(solanaActivityHiddenReason(row({ status: 'failed' })));
  assert.ok(solanaActivityHiddenReason(row({ amount: 1000n })));
  assert.ok(solanaActivityHiddenReason(row({ unknownMintIn: true })));
  assert.equal(solanaActivityHiddenReason(row({})), null);
  assert.ok(solanaActivityHiddenReason(row({ status: 'failed', feePayer: true })));
  assert.equal(solanaActivityHiddenReason(row({ direction: 'out', feePayer: true, amount: 1n })), null);
  const { shown, hidden } = splitSolanaActivity([row({}), row({ amount: 1n }), row({ status: 'failed' })]);
  assert.equal(shown.length, 1);
  assert.equal(hidden.length, 2);
});
