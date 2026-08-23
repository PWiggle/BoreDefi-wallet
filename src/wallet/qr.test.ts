import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReceiveUri, parsePaymentUri } from './qr';

const ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

test('parses a raw checksum address', () => {
  assert.deepEqual(parsePaymentUri(ADDRESS), { address: ADDRESS });
});

test('parses EIP-681 style URIs', () => {
  const parsed = parsePaymentUri(`ethereum:${ADDRESS}@8453?value=1000000000000000000`);
  assert.equal(parsed.address, ADDRESS);
  assert.equal(parsed.chainId, 8453);
  assert.equal(parsed.amount, '1');
});

test('builds a receive URI for the selected chain', () => {
  assert.equal(buildReceiveUri(ADDRESS, 137), `ethereum:${ADDRESS}@137`);
});

test('rejects non-address QR payloads', () => {
  assert.throws(() => parsePaymentUri('https://example.com'), /valid Ethereum address/);
});
