import assert from 'node:assert/strict';
import test from 'node:test';

import { formatCompactUsd, formatMarketPrice, formatNative, formatPercent, formatTokenAmount, formatUsd, parseAmountToWei, parseTokenAmount, shortenAddress } from './format';

test('shortens addresses', () => {
  assert.equal(shortenAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94'), '0x9858…da94');
});

test('formats and parses native amounts', () => {
  assert.equal(formatNative(1000000000000000000n), '1');
  assert.equal(formatNative(123456789000000000n), '0.123456');
  assert.equal(parseAmountToWei('1.5'), 1500000000000000000n);
  assert.throws(() => parseAmountToWei('abc'), /valid amount/);
  assert.equal(parseTokenAmount('1.5', 6), 1500000n);
  assert.equal(formatTokenAmount(1500000n, 6), '1.5');
  assert.equal(formatCompactUsd(1_500_000_000), '$1.5B');
  assert.equal(formatCompactUsd(null), '—');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(1234.5), '$1,234.50');
  assert.equal(formatUsd(null), '—');
  assert.equal(formatUsd(0.004), '<$0.01');
  assert.equal(formatMarketPrice(2376.8), '$2,376.80');
  assert.equal(formatMarketPrice(0.0001234), '$0.0001234');
  assert.equal(formatMarketPrice(null), '—');
  assert.equal(formatPercent(1.234), '+1.23%');
  assert.equal(formatPercent(-2), '-2.00%');
});
