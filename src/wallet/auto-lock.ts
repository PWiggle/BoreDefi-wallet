export type AutoLockMode = 'immediate' | '1m' | '5m';

export const AUTO_LOCK_OPTIONS: { mode: AutoLockMode; label: string; ms: number }[] = [
  { mode: 'immediate', label: 'Immediately', ms: 0 },
  { mode: '1m', label: '1 minute', ms: 60_000 },
  { mode: '5m', label: '5 minutes', ms: 300_000 },
];

export const DEFAULT_AUTO_LOCK: AutoLockMode = '1m';

export function normalizeAutoLock(value: unknown): AutoLockMode {
  if (value === 'immediate' || value === '1m' || value === '5m') {
    return value;
  }
  return DEFAULT_AUTO_LOCK;
}

export function autoLockMs(mode: AutoLockMode): number {
  return AUTO_LOCK_OPTIONS.find((item) => item.mode === mode)?.ms ?? 60_000;
}
