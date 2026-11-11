import { useEffect, useId } from 'react';
import { Platform } from 'react-native';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';

/**
 * Blocks screenshots / screen recording (and hides the screen in Android's recents) while `active`.
 * Each caller passes its own key so one screen closing never re-enables capture for another.
 */
export function useNoScreenCapture(key: string, active = true): void {
  const instance = useId();
  useEffect(() => {
    if (!active || Platform.OS === 'web') {
      return undefined;
    }
    const tag = `boredefi.${key}.${instance}`;
    preventScreenCaptureAsync(tag).catch(() => undefined);
    return () => {
      allowScreenCaptureAsync(tag).catch(() => undefined);
    };
  }, [active, instance, key]);
}
