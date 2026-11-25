/** How long copied wallet text stays on the clipboard before it is wiped. */
export const CLIPBOARD_CLEAR_MS = 60_000;

export type ClipboardApi = {
  setStringAsync: (text: string) => Promise<unknown>;
  getStringAsync: () => Promise<string>;
};

/**
 * How to clear when the timer fires:
 * - 'compare': read the clipboard and clear only if it still holds what we copied (Android).
 * - 'blind': clear without reading (iOS, only when the app never left the foreground since the copy,
 *   so no other app can have put something newer there; reading would show iOS's paste prompt).
 * - 'skip': leave it alone.
 */
export type ClearMode = 'compare' | 'blind' | 'skip';

type Timer = ReturnType<typeof setTimeout>;

/**
 * Copy text, then wipe it after `clearAfterMs` without touching anything the user copied later.
 * The seed phrase and private keys have no copy button at all; this covers addresses and similar.
 */
export function createClipboardGuard(
  api: ClipboardApi,
  options: {
    clearAfterMs?: number;
    /** Decides at fire time; `copiedAt` is when this copy happened. */
    clearMode?: (copiedAt: number) => ClearMode;
    now?: () => number;
    schedule?: (fn: () => void, ms: number) => Timer;
    cancel?: (t: Timer) => void;
  } = {},
) {
  const clearAfterMs = options.clearAfterMs ?? CLIPBOARD_CLEAR_MS;
  const clearMode = options.clearMode ?? (() => 'compare' as ClearMode);
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((t) => clearTimeout(t));
  let pending: Timer | null = null;

  async function clearIfUnchanged(text: string, copiedAt: number): Promise<boolean> {
    const mode = clearMode(copiedAt);
    try {
      if (mode === 'blind') {
        await api.setStringAsync('');
        return true;
      }
      if (mode === 'compare' && (await api.getStringAsync()) === text) {
        await api.setStringAsync('');
        return true;
      }
    } catch {
      // Clipboard unavailable (e.g. backgrounded on Android 10+): leave it.
    }
    return false;
  }

  async function copy(text: string): Promise<void> {
    await api.setStringAsync(text);
    const copiedAt = now();
    if (pending) {
      cancel(pending);
    }
    pending = schedule(() => {
      pending = null;
      void clearIfUnchanged(text, copiedAt);
    }, clearAfterMs);
  }

  return { copy, clearIfUnchanged };
}
