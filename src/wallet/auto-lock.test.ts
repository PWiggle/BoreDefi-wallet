import assert from 'node:assert/strict';
import test from 'node:test';

import { autoLockMs, DEFAULT_AUTO_LOCK, normalizeAutoLock } from './auto-lock';

test('defaults auto-lock to one minute', () => {
  assert.equal(DEFAULT_AUTO_LOCK, '1m');
  assert.equal(normalizeAutoLock(undefined), '1m');
  assert.equal(normalizeAutoLock('immediate'), 'immediate');
  assert.equal(autoLockMs('immediate'), 0);
  assert.equal(autoLockMs('1m'), 60_000);
  assert.equal(autoLockMs('5m'), 300_000);
});
