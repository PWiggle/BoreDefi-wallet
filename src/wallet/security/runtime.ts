import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { logger } from '../../logger';
import type { KeyValueStore } from './kv';
import { refreshPhantomList, refreshPhishingList } from './phishing';

// Expo only inlines literal `process.env.EXPO_PUBLIC_*` reads.
const BUILD_PHANTOM_FLAG: string | undefined = process.env.EXPO_PUBLIC_PHANTOM_BLOCKLIST;

/** Phantom's blocklist is opt-in (EXPO_PUBLIC_PHANTOM_BLOCKLIST=1) until Phantom OKs client-side use. */
export const PHANTOM_BLOCKLIST_ENABLED = BUILD_PHANTOM_FLAG === '1' || BUILD_PHANTOM_FLAG === 'true';

const store: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

let started: Promise<void> | null = null;

/**
 * Loads the cached scam-site lists, then refreshes them in the background when they are older than 12 hours.
 * Safe to call many times; never throws (the bundled list is always the floor).
 */
export function refreshScamLists(): Promise<void> {
  if (started) return started;
  started = (async () => {
    try {
      // refreshPhishingList loads the persisted copy first (once), then downloads only if it is stale.
      const tasks = [refreshPhishingList(fetch, { storage: store })];
      if (PHANTOM_BLOCKLIST_ENABLED) tasks.push(refreshPhantomList(fetch, { storage: store }));
      await Promise.all(tasks);
    } catch (err) {
      logger.warn('Scam list refresh failed', { message: err instanceof Error ? err.message : 'unknown' });
    }
  })().finally(() => {
    started = null;
  });
  return started;
}

/** App-level hook: refresh on launch and whenever the app comes back to the foreground (12h TTL inside). */
export function useScamListRefresh(): void {
  useEffect(() => {
    void refreshScamLists();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshScamLists();
    });
    return () => sub.remove();
  }, []);
}
