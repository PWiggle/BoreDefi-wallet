import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Expo push (free). Android: FCM V1 via Expo, needs google-services.json in the build + the FCM key in EAS.
 * iOS: APNs via Expo, needs the push capability + an APNs key in EAS. Without those, getting a token fails
 * and the screen says so; nothing else in the wallet changes.
 */
export const ALERTS_CHANNEL_ID = 'alerts';

let handlerSet = false;

/** Show alerts as banners even while the app is open. Safe to call more than once. */
export function configureNotifications(): void {
  if (handlerSet || Platform.OS === 'web') return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export type PushTokenResult =
  | { ok: true; token: string; platform: 'ios' | 'android' }
  | { ok: false; reason: 'unsupported' | 'simulator' | 'denied' | 'no-project' | 'error'; message: string };

export async function notificationsPermitted(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

/** Asks for permission (system prompt; Android 13+ needs POST_NOTIFICATIONS) and returns this phone's Expo push token. */
export async function requestPushToken(): Promise<PushTokenResult> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { ok: false, reason: 'unsupported', message: 'Notifications work in the iPhone and Android apps.' };
  }
  if (!Device.isDevice) {
    return { ok: false, reason: 'simulator', message: 'Push notifications need a real phone, not a simulator.' };
  }
  if (Platform.OS === 'android') {
    // The channel must exist before the permission prompt on Android 13+.
    await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL_ID, {
      name: 'Wallet alerts',
      description: 'Incoming funds, finished swaps, and price alerts',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') {
    return { ok: false, reason: 'denied', message: 'Notifications are off for BoreDefi. Turn them on in your phone settings.' };
  }
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return { ok: false, reason: 'no-project', message: 'This build is missing its Expo project id.' };
  }
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { ok: true, token: data, platform: Platform.OS };
  } catch {
    return {
      ok: false,
      reason: 'error',
      message: 'Could not set up push on this build yet. The notification keys may not be added to this app version.',
    };
  }
}
