import assert from 'node:assert/strict';
import test from 'node:test';

import { addressPoisoningCheck } from './security/address-poisoning';

const REAL = '0x640Ebc069e89e5691AaD192420D22a4B92443387';
const FAKE = '0x640E000000000000000000000000000000003387';

test('EVM: same first/last chars but different middle warns', () => {
  assert.ok(addressPoisoningCheck(FAKE, [REAL], 'evm'));
  assert.equal(addressPoisoningCheck(REAL, [REAL.toLowerCase()], 'evm'), null);
  assert.equal(addressPoisoningCheck('0x1111111111111111111111111111111111111111', [REAL], 'evm'), null);
});

test('Solana: case-sensitive base58 lookalike warns', () => {
  const real = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const fake = '7xKXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaagAsU';
  assert.ok(addressPoisoningCheck(fake, [real], 'solana'));
  assert.equal(addressPoisoningCheck(real, [real], 'solana'), null);
});
