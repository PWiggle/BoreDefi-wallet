export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

/** Wrong PINs allowed before the first wait. */
export const PIN_FREE_ATTEMPTS = 4;
/** Longest single wait. The wallet is never wiped automatically. */
export const PIN_MAX_LOCKOUT_MS = 24 * 60 * 60_000;

/**
 * Escalating wait after wrong PINs (no auto-wipe):
 * 1-4 -> none, 5 -> 30s, 6 -> 1m, 7 -> 5m, 8 -> 15m, 9 -> 30m, 10 -> 1h, then doubling up to 24h.
 * Each guess also costs a full vault KDF (PBKDF2-SHA256, 210k rounds), so the PIN has no fast check.
 */
export function lockoutMsAfterFailures(failCount: number): number {
  if (!Number.isFinite(failCount) || failCount <= PIN_FREE_ATTEMPTS) {
    return 0;
  }
  const steps = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
  const index = failCount - (PIN_FREE_ATTEMPTS + 1);
  if (index < steps.length) {
    return steps[index] as number;
  }
  const doublings = index - (steps.length - 1);
  return Math.min(PIN_MAX_LOCKOUT_MS, 60 * 60_000 * 2 ** Math.min(doublings, 10));
}

export function remainingLockMs(lockUntil: number, now = Date.now()): number {
  return Math.max(0, lockUntil - now);
}

/** "45s", "4m 05s", "2h 10m" for the unlock screen. */
export function formatLockWait(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
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
