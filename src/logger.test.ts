import assert from 'node:assert/strict';
import test from 'node:test';

import { redactValue } from './logger';

test('redacts mnemonic fields and 12-word phrases', () => {
  const redacted = redactValue({
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    note: 'safe',
  }) as Record<string, unknown>;
  assert.equal(redacted.mnemonic, '[redacted]');
  assert.equal(redacted.address, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
  assert.equal(redacted.note, 'safe');
  assert.equal(
    redactValue(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    ),
    '[redacted]',
  );
});
