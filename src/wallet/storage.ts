import * as SecureStore from 'expo-secure-store';

import { logger } from '../logger';
import { DEFAULT_CHAIN_ID, isChainId, type ChainId } from './chains';

const VAULT_KEY = 'boredefi.vault.v1';
const PIN_KEY = 'boredefi.pin.v1';
const SETTINGS_KEY = 'boredefi.settings.v1';

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

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
  const raw = await SecureStore.getItemAsync(VAULT_KEY, secureOptions);
  const vault = parseJson<VaultRecord>(raw);
  if (!vault || vault.version !== 1 || !vault.address || !vault.mnemonic) {
    return null;
  }
  return vault;
}

export async function saveVault(vault: VaultRecord): Promise<void> {
  await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(vault), secureOptions);
}

export async function loadPinRecord(): Promise<PinRecord | null> {
  return parseJson<PinRecord>(await SecureStore.getItemAsync(PIN_KEY, secureOptions));
}

export async function savePinRecord(record: PinRecord): Promise<void> {
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(record), secureOptions);
}

export async function loadSettings(): Promise<SettingsRecord> {
  const stored = parseJson<SettingsRecord>(
    await SecureStore.getItemAsync(SETTINGS_KEY, secureOptions),
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
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings), secureOptions);
}

export async function hasPersistedWallet(): Promise<boolean> {
  const vault = await loadVault();
  const pin = await loadPinRecord();
  return Boolean(vault && pin);
}

export async function clearAllWalletData(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(VAULT_KEY, secureOptions),
    SecureStore.deleteItemAsync(PIN_KEY, secureOptions),
    SecureStore.deleteItemAsync(SETTINGS_KEY, secureOptions),
  ]);
  logger.info('Local wallet data cleared');
}
