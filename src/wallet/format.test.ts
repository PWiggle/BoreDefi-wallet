import assert from 'node:assert/strict';
import test from 'node:test';

import { formatNative, parseAmountToWei, shortenAddress } from './format';

test('shortens addresses', () => {
  assert.equal(shortenAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94'), '0x9858…da94');
});

test('formats and parses native amounts', () => {
  assert.equal(formatNative(1000000000000000000n), '1');
  assert.equal(formatNative(123456789000000000n), '0.123456');
  assert.equal(parseAmountToWei('1.5'), 1500000000000000000n);
  assert.throws(() => parseAmountToWei('abc'), /valid amount/);
});
