import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearedPinLockState,
  isValidPin,
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

test('backs off after repeated failures', () => {
  assert.equal(lockoutMsAfterFailures(4), 0);
  assert.equal(lockoutMsAfterFailures(5), 30_000);
  assert.equal(lockoutMsAfterFailures(10), 120_000);
  assert.equal(lockoutMsAfterFailures(15), 900_000);
  const locked = nextPinLockState(4, 1_000);
  assert.equal(locked.pinFailCount, 5);
  assert.equal(locked.pinLockUntil, 1_000 + 30_000);
  assert.equal(remainingLockMs(locked.pinLockUntil, 1_000), 30_000);
  assert.deepEqual(clearedPinLockState(), { pinFailCount: 0, pinLockUntil: 0 });
});
