import assert from 'node:assert/strict';
import test from 'node:test';

import { addressWarnings, checksumAddress, isChecksummedAddress, stripInvisible } from './address-safety';

const CHECKSUM = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const LOWER = CHECKSUM.toLowerCase();

test('checksums a valid address', () => {
  assert.equal(checksumAddress(LOWER), CHECKSUM);
  assert.equal(isChecksummedAddress(CHECKSUM), true);
  assert.equal(isChecksummedAddress(LOWER), false);
});

test('warns on a non-checksum paste', () => {
  const warnings = addressWarnings(LOWER);
  assert.ok(warnings.some((item) => /checksum/i.test(item)));
});

test('warns when clipboard address does not match typed address', () => {
  const other = '0x0000000000000000000000000000000000000001';
  const warnings = addressWarnings(CHECKSUM, other);
  assert.ok(warnings.some((item) => /clipboard/i.test(item)));
});

test('warns on hidden and lookalike characters', () => {
  const hidden = `0x9858\u200BEfFD232B4033E47d90003D41EC34EcaEda94`;
  assert.notEqual(stripInvisible(hidden), hidden);
  const warnings = addressWarnings(hidden);
  assert.ok(warnings.some((item) => /hidden/i.test(item)));
  assert.ok(addressWarnings('0x9858ЕfFD232B4033E47d90003D41EC34EcaEda94').some((item) => /lookalike/i.test(item)));
});
