import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearedPinLockState,
  formatLockWait,
  isValidPin,
  PIN_MAX_LOCKOUT_MS,
  lockoutMsAfterFailures,
  nextPinLockState,
  remainingLockMs,
} from './pin-policy';

test('accepts only a 6-digit PIN', () => {
  assert.equal(isValidPin('123456'), true);
  assert.equal(isValidPin('12345'), false);
  assert.equal(isValidPin('1234567'), false);
  assert.equal(isValidPin('abcdef'), false);
});

test('backs off after repeated failures, escalating, never wiping', () => {
  assert.equal(lockoutMsAfterFailures(4), 0);
  assert.equal(lockoutMsAfterFailures(5), 30_000);
  assert.equal(lockoutMsAfterFailures(6), 60_000);
  assert.equal(lockoutMsAfterFailures(7), 5 * 60_000);
  assert.equal(lockoutMsAfterFailures(8), 15 * 60_000);
  assert.equal(lockoutMsAfterFailures(9), 30 * 60_000);
  assert.equal(lockoutMsAfterFailures(10), 60 * 60_000);
  assert.equal(lockoutMsAfterFailures(11), 2 * 60 * 60_000);
  assert.equal(lockoutMsAfterFailures(12), 4 * 60 * 60_000);
  assert.equal(lockoutMsAfterFailures(50), PIN_MAX_LOCKOUT_MS);
  for (let n = 1; n < 40; n += 1) {
    assert.ok(lockoutMsAfterFailures(n + 1) >= lockoutMsAfterFailures(n), `monotonic at ${n}`);
  }
  const locked = nextPinLockState(4, 1_000);
  assert.equal(locked.pinFailCount, 5);
  assert.equal(locked.pinLockUntil, 1_000 + 30_000);
  assert.equal(remainingLockMs(locked.pinLockUntil, 1_000), 30_000);
  assert.deepEqual(clearedPinLockState(), { pinFailCount: 0, pinLockUntil: 0 });
});

test('formats lockout waits for people', () => {
  assert.equal(formatLockWait(29_100), '30s');
  assert.equal(formatLockWait(5 * 60_000 + 5_000), '5m 05s');
  assert.equal(formatLockWait(2 * 3_600_000 + 10 * 60_000), '2h 10m');
});
