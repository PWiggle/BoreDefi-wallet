import assert from 'node:assert/strict';
import test from 'node:test';

import { redactValue, write } from './logger';

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

test('release builds drop warn/info and never print extra objects', () => {
  const calls: unknown[][] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args: unknown[]) => calls.push(['log', ...args]);
  console.warn = (...args: unknown[]) => calls.push(['warn', ...args]);
  console.error = (...args: unknown[]) => calls.push(['error', ...args]);
  try {
    write('info', 'i', { a: 1 }, false);
    write('warn', 'w', { a: 1 }, false);
    write('error', 'e', { address: '0xabc' }, false);
    assert.deepEqual(calls, [['error', 'e']]);
    calls.length = 0;
    write('warn', 'w', { pin: '123456' }, true);
    assert.deepEqual(calls, [['warn', 'w', { pin: '[redacted]' }]]);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
});
