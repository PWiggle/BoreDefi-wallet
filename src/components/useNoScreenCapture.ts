import { useEffect, useId } from 'react';
import { Platform } from 'react-native';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';

/**
 * Blocks screenshots / screen recording (and hides the screen in Android's recents) while `active`. Android only.
 * Each caller passes its own key so one screen closing never re-enables capture for another.
 */
export function useNoScreenCapture(key: string, active = true): void {
  const instance = useId();
  useEffect(() => {
    // Android only (FLAG_SECURE). On iOS, expo-screen-capture 57.0.2 re-parents the key window, which
    // flickered the unlock screen under the Face ID sheet and could stop the PIN pad taking taps.
    if (!active || Platform.OS !== 'android') {
      return undefined;
    }
    const tag = `boredefi.${key}.${instance}`;
    preventScreenCaptureAsync(tag).catch(() => undefined);
    return () => {
      allowScreenCaptureAsync(tag).catch(() => undefined);
    };
  }, [active, instance, key]);
}
