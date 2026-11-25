import * as Clipboard from 'expo-clipboard';
import { AppState, Platform } from 'react-native';

import { createClipboardGuard, type ClearMode } from './clipboard-guard';

/** Last time the app left the foreground (iOS can't safely read the pasteboard after that). */
let lastLeftForegroundAt = 0;
AppState.addEventListener('change', (state) => {
  if (state !== 'active') {
    lastLeftForegroundAt = Date.now();
  }
});

function clearMode(copiedAt: number): ClearMode {
  if (Platform.OS === 'android') {
    return 'compare';
  }
  if (Platform.OS === 'ios') {
    // Still in the foreground since the copy: nothing else can have replaced it, so clear it.
    return AppState.currentState === 'active' && lastLeftForegroundAt < copiedAt ? 'blind' : 'skip';
  }
  return 'skip';
}

/** App-wide copy helper: wipes copied wallet text from the clipboard after about 60 seconds. */
const guard = createClipboardGuard(
  {
    setStringAsync: (text) => Clipboard.setStringAsync(text),
    getStringAsync: () => Clipboard.getStringAsync(),
  },
  { clearMode },
);

export function copyWithAutoClear(text: string): Promise<void> {
  return guard.copy(text);
}
