import assert from 'node:assert/strict';
import test from 'node:test';

import { isSameChainSwap, parseLiFiQuote, quoteContainsBridge } from './swap';

const quote = {
  tool: '1inch',
  toolDetails: { name: '1inch' },
  action: { fromChainId: 8453, toChainId: 8453, fromAmount: '10000000000000000' },
  estimate: {
    toAmount: '23674492',
    toAmountMin: '23500000',
    approvalAddress: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
  },
  includedSteps: [{ type: 'swap', tool: '1inch' }],
  transactionRequest: {
    to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
    data: '0x1234',
    value: '0x2386f26fc10000',
  },
};

test('accepts same-chain aggregator quotes and rejects bridges', () => {
  assert.equal(isSameChainSwap(8453, 8453), true);
  assert.equal(isSameChainSwap(8453, 1), false);
  assert.equal(quoteContainsBridge([{ type: 'swap', tool: '1inch' }]), false);
  assert.equal(quoteContainsBridge([{ type: 'cross', tool: 'stargate' }]), true);

  const parsed = parseLiFiQuote(quote, 8453);
  assert.equal(parsed.tool, '1inch');
  assert.equal(parsed.toAmount, 23674492n);
  assert.equal(parsed.transactionRequest.value, 0x2386f26fc10000n);
});

test('refuses a cross-chain LI.FI quote', () => {
  assert.throws(
    () => parseLiFiQuote({ ...quote, action: { ...quote.action, toChainId: 1 } }, 8453),
    /same-chain/,
  );
});
