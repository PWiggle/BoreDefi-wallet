import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { logger } from '../logger';
import { DEFAULT_APPEARANCE, normalizeAppearance, type AppearanceMode } from '../theme';
import { DEFAULT_AUTO_LOCK, normalizeAutoLock, type AutoLockMode } from './auto-lock';
import { CHAINS, DEFAULT_CHAIN_ID, parseChainId, type ChainId } from './chains';
import { type NftItem } from './nfts';
import type { PinRecord } from './pin-verify';
import { KNOWN_ADDR_KINDS } from './address-book-kinds';
import { normalizePolicy, pruneExpiredWindows, type ProtectedPolicy } from './protected-policy';
import {
  dekToHex,
  hexToDek,
  parseStoredVault,
  type StoredVault,
  type VaultV2Record,
} from './vault-crypto';

const VAULT_KEY = 'boredefi.vault.v1';
const PIN_KEY = 'boredefi.pin.v1';
const SETTINGS_KEY = 'boredefi.settings.v1';
/** Old biometric vault key: readable whenever the phone is unlocked. Migrated away and deleted. */
const LEGACY_DEK_KEY = 'boredefi.vault.dek';
/** Biometric vault key gated by the OS (Android Keystore user auth / iOS biometryCurrentSet). */
const BIO_DEK_KEY = 'boredefi.vault.dek.bio.v2';
const BIO_KEYCHAIN_SERVICE = 'boredefi.biometric.v2';
const NFT_REVEAL_KEY = 'boredefi.nft.revealed.v1';
const NFT_HIDDEN_KEY = 'boredefi.nft.hidden.v1';
const NFT_IMPORT_KEY = 'boredefi.nft.imported.v1';
const NFT_LAST_GOOD_PREFIX = 'boredefi.nft.lastgood.v1.';
const PROTECTED_POLICY_KEY = 'boredefi.protected.policy.v1';

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * Push-alert device credentials (feature branch). Wiped on reset so a new wallet on this install
 * never inherits the old device identity. Deleting a key that does not exist is harmless.
 */
const ALERT_KEYS = ['boredefi.alerts.device.v1', 'boredefi.alerts.prefs.v1'];
const alertOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function bioOptions(prompt?: string): SecureStore.SecureStoreOptions {
  return {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    keychainService: BIO_KEYCHAIN_SERVICE,
    requireAuthentication: true,
    ...(prompt ? { authenticationPrompt: prompt } : {}),
  };
}

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

export type { PinRecord } from './pin-verify';

export type SettingsRecord = {
  biometricsEnabled: boolean;
  selectedChainId: ChainId;
  backupCompleted: boolean;
  autoLock: AutoLockMode;
  appearance: AppearanceMode;
  hideBalances: boolean;
  pinFailCount: number;
  pinLockUntil: number;
};

export const defaultSettings: SettingsRecord = {
  biometricsEnabled: false,
  selectedChainId: DEFAULT_CHAIN_ID,
  backupCompleted: false,
  autoLock: DEFAULT_AUTO_LOCK,
  appearance: DEFAULT_APPEARANCE,
  hideBalances: false,
  pinFailCount: 0,
  pinLockUntil: 0,
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

export async function loadStoredVault(): Promise<StoredVault | null> {
  return parseStoredVault(parseJson<unknown>(await readItem(VAULT_KEY)));
}

/** @deprecated Plaintext v1 only. Use loadStoredVault + decrypt. */
export async function loadVault(): Promise<{ version: 1; address: string; mnemonic: string } | null> {
  const vault = await loadStoredVault();
  if (!vault || vault.version !== 1) {
    return null;
  }
  return vault;
}

export async function saveEncryptedVault(vault: VaultV2Record): Promise<void> {
  await writeItem(VAULT_KEY, JSON.stringify(vault));
}

export async function saveVault(vault: StoredVault): Promise<void> {
  await writeItem(VAULT_KEY, JSON.stringify(vault));
}

/** Current records are a marker only (no PIN hash); old installs may still hold a legacy { salt, hash }. */
export async function loadPinRecord(): Promise<PinRecord | null> {
  return parseJson<PinRecord>(await readItem(PIN_KEY));
}

export async function savePinRecord(record: PinRecord): Promise<void> {
  await writeItem(PIN_KEY, JSON.stringify(record));
}

export async function loadSettings(): Promise<SettingsRecord> {
  const stored = parseJson<Partial<SettingsRecord>>(await readItem(SETTINGS_KEY));
  if (!stored) {
    return defaultSettings;
  }
  return {
    biometricsEnabled: Boolean(stored.biometricsEnabled),
    selectedChainId: parseChainId(stored.selectedChainId ?? DEFAULT_CHAIN_ID) ?? DEFAULT_CHAIN_ID,
    backupCompleted: Boolean(stored.backupCompleted),
    autoLock: normalizeAutoLock(stored.autoLock),
    appearance: normalizeAppearance(stored.appearance),
    hideBalances: Boolean(stored.hideBalances),
    pinFailCount: Number.isFinite(stored.pinFailCount) ? Number(stored.pinFailCount) : 0,
    pinLockUntil: Number.isFinite(stored.pinLockUntil) ? Number(stored.pinLockUntil) : 0,
  };
}

export async function saveSettings(settings: SettingsRecord): Promise<void> {
  await writeItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** True when this device can hold an OS biometric-gated secret (strong biometrics enrolled). */
export function canUseGatedBiometricStore(): boolean {
  if (isWebStorage()) {
    return false;
  }
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

/**
 * Save the vault data key behind OS biometrics (requireAuthentication). On Android this shows the
 * system biometric prompt; on iOS the item is created without a prompt and every read needs Face ID /
 * Touch ID (biometryCurrentSet). Throws if the user cancels or biometrics are unavailable.
 */
export async function saveBiometricDek(dek: Uint8Array, prompt = 'Turn on biometric unlock'): Promise<void> {
  if (isWebStorage()) {
    return;
  }
  // iOS asks for biometrics when *updating* a gated item, so delete first and create fresh.
  await SecureStore.deleteItemAsync(BIO_DEK_KEY, bioOptions()).catch(() => undefined);
  await SecureStore.setItemAsync(BIO_DEK_KEY, dekToHex(dek), bioOptions(prompt));
  await clearLegacyBiometricDek();
}

export type BiometricDekRead =
  | { status: 'ok'; dek: Uint8Array }
  /** Nothing stored, or the OS invalidated it (fingerprints / face changed). Use the PIN. */
  | { status: 'missing' }
  /** User cancelled or the prompt failed. */
  | { status: 'cancelled' };

/** Read the gated data key. The OS shows the biometric prompt; app code cannot skip it. */
export async function loadBiometricDek(prompt = 'Unlock BoreDefi Wallet'): Promise<BiometricDekRead> {
  if (isWebStorage()) {
    return { status: 'missing' };
  }
  let hex: string | null;
  try {
    hex = await SecureStore.getItemAsync(BIO_DEK_KEY, bioOptions(prompt));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/invalidat|no biometrics|not enrolled|no hardware|unsupported/i.test(message)) {
      return { status: 'missing' };
    }
    return { status: 'cancelled' };
  }
  const dek = hex ? hexToDek(hex) : null;
  return dek ? { status: 'ok', dek } : { status: 'missing' };
}

/** Old ungated copy (pre-hardening installs). Read once to migrate, then deleted. */
export async function loadLegacyBiometricDek(): Promise<Uint8Array | null> {
  if (isWebStorage()) {
    return null;
  }
  try {
    const hex = await readItem(LEGACY_DEK_KEY);
    return hex ? hexToDek(hex) : null;
  } catch {
    return null;
  }
}

export async function clearLegacyBiometricDek(): Promise<void> {
  if (isWebStorage()) {
    return;
  }
  await removeItem(LEGACY_DEK_KEY).catch(() => undefined);
}

export async function clearBiometricDek(): Promise<void> {
  if (isWebStorage()) {
    return;
  }
  await Promise.all([
    SecureStore.deleteItemAsync(BIO_DEK_KEY, bioOptions()).catch(() => undefined),
    clearLegacyBiometricDek(),
  ]);
}

export async function hasPersistedWallet(): Promise<boolean> {
  const vault = await loadStoredVault();
  const pin = await loadPinRecord();
  return Boolean(vault && pin);
}

export async function loadRevealedNfts(): Promise<string[]> {
  const stored = parseJson<string[]>(await readItem(NFT_REVEAL_KEY));
  return Array.isArray(stored) ? stored.filter((item) => typeof item === 'string') : [];
}

export async function saveRevealedNfts(keys: string[]): Promise<void> {
  await writeItem(NFT_REVEAL_KEY, JSON.stringify([...new Set(keys)]));
}

export async function loadHiddenNfts(): Promise<string[]> {
  const stored = parseJson<string[]>(await readItem(NFT_HIDDEN_KEY));
  return Array.isArray(stored) ? stored.filter((item) => typeof item === 'string') : [];
}

export async function saveHiddenNfts(keys: string[]): Promise<void> {
  await writeItem(NFT_HIDDEN_KEY, JSON.stringify([...new Set(keys)]));
}

export async function loadImportedNfts(): Promise<NftItem[]> {
  const stored = parseJson<NftItem[]>(await readItem(NFT_IMPORT_KEY));
  return Array.isArray(stored) ? stored : [];
}

export async function saveImportedNfts(items: NftItem[]): Promise<void> {
  await writeItem(NFT_IMPORT_KEY, JSON.stringify(items));
}

export async function loadProtectedPolicy(): Promise<ProtectedPolicy> {
  return pruneExpiredWindows(normalizePolicy(parseJson<unknown>(await readItem(PROTECTED_POLICY_KEY))));
}

export async function saveProtectedPolicy(policy: ProtectedPolicy): Promise<void> {
  await writeItem(PROTECTED_POLICY_KEY, JSON.stringify(normalizePolicy(policy)));
}

/**
 * Wipe everything this wallet stored on the device: vault, PIN marker, settings, both biometric keys,
 * NFT state and caches, the address book, and push-alert device credentials. `owners` = addresses whose
 * per-wallet caches should go too (current EVM address); all known chains are covered.
 */
export async function clearAllWalletData(owners: (string | null | undefined)[] = []): Promise<void> {
  const ownerList = owners.filter((o): o is string => Boolean(o));
  const lastGoodKeys = ownerList.flatMap((owner) =>
    Object.keys(CHAINS).map((chainId) => nftLastGoodKey(owner, Number(chainId))),
  );
  const results = await Promise.allSettled([
    removeItem(VAULT_KEY),
    removeItem(PIN_KEY),
    removeItem(SETTINGS_KEY),
    clearBiometricDek(),
    removeItem(NFT_REVEAL_KEY),
    removeItem(NFT_HIDDEN_KEY),
    removeItem(NFT_IMPORT_KEY),
    removeItem(PROTECTED_POLICY_KEY),
    ...KNOWN_ADDR_KINDS.map((kind) => removeItem(`${KNOWN_ADDR_PREFIX}${kind}`)),
    ...lastGoodKeys.map((key) => removeItem(key)),
    ...ALERT_KEYS.map((key) =>
      isWebStorage() ? removeItem(key) : SecureStore.deleteItemAsync(key, alertOptions),
    ),
  ]);
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed) {
    logger.warn('Some local wallet data could not be cleared', { failed });
  }
  logger.info('Local wallet data cleared');
}

/** Last NFT list that loaded for one wallet + network; shown when the catalog is briefly unreachable. */
function nftLastGoodKey(owner: string, chainId: number): string {
  return `${NFT_LAST_GOOD_PREFIX}${chainId}.${owner.toLowerCase()}`;
}

export async function loadLastGoodNfts(owner: string, chainId: number): Promise<NftItem[] | null> {
  try {
    const stored = parseJson<NftItem[]>(await readItem(nftLastGoodKey(owner, chainId)));
    return Array.isArray(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function saveLastGoodNfts(owner: string, chainId: number, items: NftItem[]): Promise<void> {
  try {
    await writeItem(nftLastGoodKey(owner, chainId), JSON.stringify(items));
  } catch {
    // Cache only; never block the NFT tab.
  }
}

/** Addresses this wallet has sent to (and its own), for the address-poisoning guard. Small list, newest first. */
const KNOWN_ADDR_PREFIX = 'boredefi.known.addresses.v1.';
const KNOWN_ADDR_MAX = 25;

/** 'evm' (case-insensitive hex) or a non-EVM chain family key (case-sensitive). */
export type AddressBookKind = string;

export async function loadKnownAddresses(kind: AddressBookKind): Promise<string[]> {
  try {
    const stored = parseJson<string[]>(await readItem(`${KNOWN_ADDR_PREFIX}${kind}`));
    return Array.isArray(stored) ? stored.filter((a) => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

export async function rememberKnownAddresses(kind: AddressBookKind, addresses: (string | null | undefined)[]): Promise<void> {
  try {
    const current = await loadKnownAddresses(kind);
    const norm = (a: string) => (kind === 'evm' ? a.toLowerCase() : a);
    const merged: string[] = [];
    for (const a of [...addresses, ...current]) {
      if (a && !merged.some((m) => norm(m) === norm(a))) merged.push(a);
    }
    await writeItem(`${KNOWN_ADDR_PREFIX}${kind}`, JSON.stringify(merged.slice(0, KNOWN_ADDR_MAX)));
  } catch {
    // Guard data only; never block a send.
  }
}
