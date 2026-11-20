/**
 * The Face ID / Touch ID sheet makes iOS report the app as inactive and then active again. Without a
 * guard the auto-lock timer treats that as the app being hidden: with "Immediately" auto-lock it
 * re-locks the wallet right after a good biometric unlock, and it can race with the unlock itself,
 * so the screen flips back to the unlock/PIN page. While a biometric prompt is open, and for a short
 * grace period after it closes (the 'active' event can arrive after the prompt promise resolves),
 * app visibility changes must not touch the lock state.
 */
export const PROMPT_GRACE_MS = 1_500;

export type PromptGuard = {
  /** Call before showing any biometric prompt or gated keychain read. */
  begin: () => void;
  /** Call (in a finally) once the prompt promise settles. */
  end: (now?: number) => void;
  /** True while a prompt is open or inside the grace window. */
  isSuppressed: (now?: number) => boolean;
};

export function createPromptGuard(graceMs: number = PROMPT_GRACE_MS): PromptGuard {
  let open = 0;
  let graceUntil = 0;
  return {
    begin() {
      open += 1;
    },
    end(now = Date.now()) {
      open = Math.max(0, open - 1);
      graceUntil = now + graceMs;
    },
    isSuppressed(now = Date.now()) {
      return open > 0 || now < graceUntil;
    },
  };
}

/** Run a biometric prompt with the guard held; never throws, a failure reads as "cancelled". */
export async function withBiometricPrompt<T>(
  guard: PromptGuard,
  run: () => Promise<T>,
  onError: T,
): Promise<T> {
  guard.begin();
  try {
    return await run();
  } catch {
    return onError;
  } finally {
    guard.end();
  }
}

/**
 * True exactly once per cold start. The unlock screen auto-prompts Face ID with this, so a remount or
 * re-lock can never start a prompt loop; the "Use biometrics" button stays available for a manual retry.
 */
export function createOnce(): { take: () => boolean } {
  let used = false;
  return {
    take() {
      if (used) {
        return false;
      }
      used = true;
      return true;
    },
  };
}
