import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { DeviceCredentials } from './client';

const CREDENTIALS_KEY = 'boredefi.alerts.device.v1';
const PREFS_KEY = 'boredefi.alerts.prefs.v1';

export type AlertPrefs = { notificationsOn: boolean; incomingEnabled: boolean };
export const DEFAULT_ALERT_PREFS: AlertPrefs = { notificationsOn: false, incomingEnabled: true };

const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

async function read(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key, options);
}

async function write(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Private browsing: keep going without persistence.
    }
    return;
  }
  await SecureStore.setItemAsync(key, value, options);
}

async function remove(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.deleteItemAsync(key, options);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A random id + 32-byte secret for this install. Not derived from the wallet, so it reveals nothing about it. */
export async function getDeviceCredentials(): Promise<DeviceCredentials> {
  const stored = await read(CREDENTIALS_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as DeviceCredentials;
      if (parsed.deviceId && /^[0-9a-f]{64}$/.test(parsed.secret)) return parsed;
    } catch {
      // fall through and make new ones
    }
  }
  const credentials = { deviceId: Crypto.randomUUID(), secret: hex(Crypto.getRandomBytes(32)) };
  await write(CREDENTIALS_KEY, JSON.stringify(credentials));
  return credentials;
}

export async function forgetDeviceCredentials(): Promise<void> {
  await remove(CREDENTIALS_KEY);
}

export async function loadAlertPrefs(): Promise<AlertPrefs> {
  try {
    const raw = await read(PREFS_KEY);
    if (!raw) return DEFAULT_ALERT_PREFS;
    const parsed = JSON.parse(raw) as Partial<AlertPrefs>;
    return {
      notificationsOn: parsed.notificationsOn === true,
      incomingEnabled: parsed.incomingEnabled !== false,
    };
  } catch {
    return DEFAULT_ALERT_PREFS;
  }
}

export async function saveAlertPrefs(prefs: AlertPrefs): Promise<void> {
  await write(PREFS_KEY, JSON.stringify(prefs));
}
