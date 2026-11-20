import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createPromptGuard, PROMPT_GRACE_MS, withBiometricPrompt } from './prompt-guard';

test('guard is quiet until a prompt opens, holds while open, and keeps a short grace after', () => {
  const guard = createPromptGuard(1_000);
  assert.equal(guard.isSuppressed(0), false);
  guard.begin();
  assert.equal(guard.isSuppressed(5_000), true);
  guard.end(5_000);
  assert.equal(guard.isSuppressed(5_500), true, 'late AppState "active" after the sheet closes is ignored');
  assert.equal(guard.isSuppressed(6_001), false);
});

test('nested prompts keep the guard until the last one closes', () => {
  const guard = createPromptGuard(0);
  guard.begin();
  guard.begin();
  guard.end(10);
  assert.equal(guard.isSuppressed(10), true);
  guard.end(20);
  assert.equal(guard.isSuppressed(20), false);
  guard.end(30); // extra end never goes negative
  guard.begin();
  assert.equal(guard.isSuppressed(30), true);
});

test('default grace is short enough that a real background still locks', () => {
  assert.ok(PROMPT_GRACE_MS > 0 && PROMPT_GRACE_MS <= 3_000);
});

test('withBiometricPrompt returns the result and releases the guard', async () => {
  const guard = createPromptGuard(0);
  const result = await withBiometricPrompt(guard, async () => {
    assert.equal(guard.isSuppressed(), true);
    return 'ok' as const;
  }, 'cancelled' as const);
  assert.equal(result, 'ok');
  assert.equal(guard.isSuppressed(Date.now() + 1), false);
});

test('withBiometricPrompt turns a thrown keychain / Face ID error into the fallback and still releases the guard', async () => {
  const guard = createPromptGuard(0);
  const result = await withBiometricPrompt(guard, async () => {
    throw new Error('Keychain error -25293');
  }, 'cancelled' as const);
  assert.equal(result, 'cancelled');
  assert.equal(guard.isSuppressed(Date.now() + 1), false);
});

test('wiring: AppState handlers honor the guard, biometric unlock is wrapped, PIN unlock survives migration errors', () => {
  const ctx = readFileSync(new URL('../context/WalletContext.tsx', import.meta.url), 'utf8');
  assert.match(ctx, /handleAppHidden = useCallback\(\(\) => \{\s*if \(promptGuardRef\.current\.isSuppressed\(\)\)/);
  assert.match(ctx, /handleAppVisible = useCallback\(\(\) => \{\s*if \(promptGuardRef\.current\.isSuppressed\(\)\)/);
  assert.match(ctx, /withBiometricPrompt<BiometricUnlockResult>\(promptGuardRef\.current, runBiometricUnlock, 'cancelled'\)/);
  assert.match(ctx, /try \{\s*await migrateLegacyDekAfterPin\(opened\.dek\);\s*\} catch/);
  // The old ungated key is only deleted after the gated copy is stored (or when biometrics are turned off).
  assert.doesNotMatch(ctx, /const opened = tryOpenVaultWithDek\(vault, legacy\);\s*await clearLegacyBiometricDek\(\);/);
});

test('wiring: UnlockScreen cannot strand a full PIN pad or an unhandled rejection', () => {
  const screen = readFileSync(new URL('../screens/UnlockScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /\.catch\(\(\) => \{[\s\S]*setPin\(''\)/);
  assert.match(screen, /try \{\s*result = await unlockWithBiometrics\(\);\s*\} catch/);
});
