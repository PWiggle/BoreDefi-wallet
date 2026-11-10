export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export function lockoutMsAfterFailures(failCount: number): number {
  if (failCount >= 15) {
    return 15 * 60_000;
  }
  if (failCount >= 10) {
    return 2 * 60_000;
  }
  if (failCount >= 5) {
    return 30_000;
  }
  return 0;
}

export function remainingLockMs(lockUntil: number, now = Date.now()): number {
  return Math.max(0, lockUntil - now);
}

export function nextPinLockState(
  failCount: number,
  now = Date.now(),
): { pinFailCount: number; pinLockUntil: number } {
  const pinFailCount = failCount + 1;
  return {
    pinFailCount,
    pinLockUntil: now + lockoutMsAfterFailures(pinFailCount),
  };
}

export function clearedPinLockState(): { pinFailCount: number; pinLockUntil: number } {
  return { pinFailCount: 0, pinLockUntil: 0 };
}
