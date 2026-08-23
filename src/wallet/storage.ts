import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { logger } from '../logger';
import { DEFAULT_CHAIN_ID, isChainId, type ChainId } from './chains';

const VAULT_KEY = 'boredefi.vault.v1';
const PIN_KEY = 'boredefi.pin.v1';
const SETTINGS_KEY = 'boredefi.settings.v1';

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const webMemory = new Map<string, string>();

function isWebStorage(): boolean {
  return Platform.OS === 'web';
}

async function readItem(key: string): Promise<string | null> {
  if (!isWebStorage()) {
    return SecureStore.getItemAsync(key, secureOptions);
  }
  try {
    return globalThis.localStorage?.getItem(key) ?? webMemory.get(key) ?? null;
  } catch {
    return webMemory.get(key) ?? null;
  }
}

async function writeItem(key: string, value: string): Promise<void> {
  if (!isWebStorage()) {
    await SecureStore.setItemAsync(key, value, secureOptions);
    return;
  }
  webMemory.set(key, value);
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Private-mode browsers can block localStorage. Memory still works for the tab.
  }
}

async function removeItem(key: string): Promise<void> {
  if (!isWebStorage()) {
    await SecureStore.deleteItemAsync(key, secureOptions);
    return;
  }
  webMemory.delete(key);
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Ignore quota / privacy errors.
  }
}

export type VaultRecord = {
  version: 1;
  address: string;
  mnemonic: string;
};

export type PinRecord = {
  salt: string;
  hash: string;
};

export type SettingsRecord = {
  biometricsEnabled: boolean;
  selectedChainId: ChainId;
  backupCompleted: boolean;
};

const defaultSettings: SettingsRecord = {
  biometricsEnabled: false,
  selectedChainId: DEFAULT_CHAIN_ID,
  backupCompleted: false,
};

function parseJson<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    logger.error('Stored record was unreadable');
    return null;
  }
}

export async function loadVault(): Promise<VaultRecord | null> {
  const raw = await readItem(VAULT_KEY);
  const vault = parseJson<VaultRecord>(raw);
  if (!vault || vault.version !== 1 || !vault.address || !vault.mnemonic) {
    return null;
  }
  return vault;
}

export async function saveVault(vault: VaultRecord): Promise<void> {
  await writeItem(VAULT_KEY, JSON.stringify(vault));
}

export async function loadPinRecord(): Promise<PinRecord | null> {
  return parseJson<PinRecord>(await readItem(PIN_KEY));
}

export async function savePinRecord(record: PinRecord): Promise<void> {
  await writeItem(PIN_KEY, JSON.stringify(record));
}

export async function loadSettings(): Promise<SettingsRecord> {
  const stored = parseJson<SettingsRecord>(
    await readItem(SETTINGS_KEY),
  );
  if (!stored) {
    return defaultSettings;
  }
  return {
    biometricsEnabled: Boolean(stored.biometricsEnabled),
    selectedChainId: isChainId(stored.selectedChainId)
      ? stored.selectedChainId
      : DEFAULT_CHAIN_ID,
    backupCompleted: Boolean(stored.backupCompleted),
  };
}

export async function saveSettings(settings: SettingsRecord): Promise<void> {
  await writeItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function hasPersistedWallet(): Promise<boolean> {
  const vault = await loadVault();
  const pin = await loadPinRecord();
  return Boolean(vault && pin);
}

export async function clearAllWalletData(): Promise<void> {
  await Promise.all([
    removeItem(VAULT_KEY),
    removeItem(PIN_KEY),
    removeItem(SETTINGS_KEY),
  ]);
  logger.info('Local wallet data cleared');
}
