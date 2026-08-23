import { gcm } from '@noble/ciphers/aes';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils';

export const VAULT_KDF = 'pbkdf2-sha256' as const;
export const VAULT_KDF_ITERATIONS = 210_000;
export const VAULT_SALT_LEN = 16;
export const VAULT_NONCE_LEN = 12;
export const VAULT_DEK_LEN = 32;

export type VaultV1Record = {
  version: 1;
  address: string;
  mnemonic: string;
};

export type VaultV2Record = {
  version: 2;
  address: string;
  kdf: typeof VAULT_KDF;
  iterations: number;
  salt: string;
  wrapNonce: string;
  wrappedDek: string;
  vaultNonce: string;
  ciphertext: string;
};

export type StoredVault = VaultV1Record | VaultV2Record;

export type OpenVault = {
  mnemonic: string;
  address: string;
  dek: Uint8Array;
};

function aesEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array {
  return gcm(key, nonce).encrypt(plaintext);
}

function aesDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return gcm(key, nonce).decrypt(ciphertext);
}

export function deriveVaultKey(pin: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, pin, salt, { c: iterations, dkLen: 32 });
}

export function isVaultV1(value: unknown): value is VaultV1Record {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as VaultV1Record;
  return record.version === 1 && Boolean(record.address) && Boolean(record.mnemonic);
}

export function isVaultV2(value: unknown): value is VaultV2Record {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as VaultV2Record;
  return (
    record.version === 2 &&
    record.kdf === VAULT_KDF &&
    typeof record.iterations === 'number' &&
    record.iterations >= 1_000 &&
    Boolean(record.address) &&
    Boolean(record.salt) &&
    Boolean(record.wrapNonce) &&
    Boolean(record.wrappedDek) &&
    Boolean(record.vaultNonce) &&
    Boolean(record.ciphertext)
  );
}

export function parseStoredVault(value: unknown): StoredVault | null {
  if (isVaultV2(value)) {
    return value;
  }
  if (isVaultV1(value)) {
    return value;
  }
  return null;
}

export function encryptVault(
  mnemonic: string,
  address: string,
  pin: string,
  iterations: number = VAULT_KDF_ITERATIONS,
  existingDek?: Uint8Array,
): { vault: VaultV2Record; dek: Uint8Array } {
  const salt = randomBytes(VAULT_SALT_LEN);
  const dek = existingDek ?? randomBytes(VAULT_DEK_LEN);
  const wrapNonce = randomBytes(VAULT_NONCE_LEN);
  const vaultNonce = randomBytes(VAULT_NONCE_LEN);
  const pinKey = deriveVaultKey(pin, salt, iterations);
  const wrappedDek = aesEncrypt(pinKey, wrapNonce, dek);
  const ciphertext = aesEncrypt(dek, vaultNonce, utf8ToBytes(JSON.stringify({ mnemonic })));
  return {
    dek,
    vault: {
      version: 2,
      address,
      kdf: VAULT_KDF,
      iterations,
      salt: bytesToHex(salt),
      wrapNonce: bytesToHex(wrapNonce),
      wrappedDek: bytesToHex(wrappedDek),
      vaultNonce: bytesToHex(vaultNonce),
      ciphertext: bytesToHex(ciphertext),
    },
  };
}

export function decryptVault(vault: VaultV2Record, pin: string): OpenVault {
  const pinKey = deriveVaultKey(pin, hexToBytes(vault.salt), vault.iterations);
  const dek = aesDecrypt(pinKey, hexToBytes(vault.wrapNonce), hexToBytes(vault.wrappedDek));
  return openVaultWithDek(vault, dek);
}

export function openVaultWithDek(vault: VaultV2Record, dek: Uint8Array): OpenVault {
  const plaintext = aesDecrypt(dek, hexToBytes(vault.vaultNonce), hexToBytes(vault.ciphertext));
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { mnemonic?: string };
  if (!parsed.mnemonic) {
    throw new Error('Vault payload is missing the recovery phrase');
  }
  return { mnemonic: parsed.mnemonic, address: vault.address, dek };
}

export function tryDecryptVault(vault: VaultV2Record, pin: string): OpenVault | null {
  try {
    return decryptVault(vault, pin);
  } catch {
    return null;
  }
}

export function tryOpenVaultWithDek(vault: VaultV2Record, dek: Uint8Array): OpenVault | null {
  try {
    return openVaultWithDek(vault, dek);
  } catch {
    return null;
  }
}

export function migrateVaultV1(
  vault: VaultV1Record,
  pin: string,
  iterations: number = VAULT_KDF_ITERATIONS,
): { vault: VaultV2Record; dek: Uint8Array } {
  return encryptVault(vault.mnemonic, vault.address, pin, iterations);
}

export function rewrapVault(
  vault: VaultV2Record,
  oldPin: string,
  newPin: string,
): { vault: VaultV2Record; dek: Uint8Array } | null {
  const opened = tryDecryptVault(vault, oldPin);
  if (!opened) {
    return null;
  }
  return encryptVault(opened.mnemonic, vault.address, newPin, vault.iterations, opened.dek);
}

export function vaultContainsPlainMnemonic(value: unknown): boolean {
  return isVaultV1(value);
}

export function hexToDek(hex: string): Uint8Array | null {
  try {
    const bytes = hexToBytes(hex);
    return bytes.length === VAULT_DEK_LEN ? bytes : null;
  } catch {
    return null;
  }
}

export function dekToHex(dek: Uint8Array): string {
  return bytesToHex(dek);
}
