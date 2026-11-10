import assert from 'node:assert/strict';
import test from 'node:test';

import { addressPoisoningCheck } from './security/address-poisoning';

const REAL = '0xAaBbCcDd111111111111111111111111EeFf0011';
const FAKE = '0xAaBb000000000000000000000000000000Ff0011';

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
