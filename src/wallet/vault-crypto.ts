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

/** Noble PBKDF2-SHA256. Used in tests, on web, and if the native module is missing. */
export function deriveVaultKeyNoble(pin: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, pin, salt, { c: iterations, dkLen: 32 });
}

type NativePbkdf2 = (
  password: string,
  salt: Uint8Array,
  iterations: number,
  keylen: number,
  digest: string,
  callback: (err: Error | null, derivedKey?: Uint8Array) => void,
) => void;

function loadNativePbkdf2(): NativePbkdf2 | null {
  const isReactNative =
    typeof navigator !== 'undefined' && (navigator as { product?: string }).product === 'ReactNative';
  if (!isReactNative) {
    return null;
  }
  try {
    const mod = require('react-native-quick-crypto') as { pbkdf2?: NativePbkdf2 };
    return typeof mod.pbkdf2 === 'function' ? mod.pbkdf2 : null;
  } catch {
    return null;
  }
}

/**
 * PBKDF2-SHA256, 32-byte key. On Android and iOS this is OpenSSL via
 * react-native-quick-crypto (async, off the JS thread). The salt is passed
 * as a byte array so embedded NUL bytes are kept.
 */
export async function deriveVaultKey(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const native = loadNativePbkdf2();
  if (!native) {
    return deriveVaultKeyNoble(pin, salt, iterations);
  }
  const saltBytes = Uint8Array.from(salt);
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      native(pin, saltBytes, iterations, 32, 'sha256', (err, derivedKey) => {
        if (err || !derivedKey) {
          reject(err ?? new Error('Native PBKDF2 returned no key'));
          return;
        }
        resolve(new Uint8Array(derivedKey));
      });
    });
  } catch {
    return deriveVaultKeyNoble(pin, salt, iterations);
  }
}

/** Let the 6th PIN dot and the securing spinner paint before key derivation. */
export function yieldForPaint(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
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

export async function encryptVault(
  mnemonic: string,
  address: string,
  pin: string,
  iterations: number = VAULT_KDF_ITERATIONS,
  existingDek?: Uint8Array,
): Promise<{ vault: VaultV2Record; dek: Uint8Array }> {
  const salt = randomBytes(VAULT_SALT_LEN);
  const dek = existingDek ?? randomBytes(VAULT_DEK_LEN);
  const wrapNonce = randomBytes(VAULT_NONCE_LEN);
  const vaultNonce = randomBytes(VAULT_NONCE_LEN);
  const pinKey = await deriveVaultKey(pin, salt, iterations);
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

export async function decryptVault(vault: VaultV2Record, pin: string): Promise<OpenVault> {
  const pinKey = await deriveVaultKey(pin, hexToBytes(vault.salt), vault.iterations);
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

export async function tryDecryptVault(vault: VaultV2Record, pin: string): Promise<OpenVault | null> {
  try {
    return await decryptVault(vault, pin);
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

export async function migrateVaultV1(
  vault: VaultV1Record,
  pin: string,
  iterations: number = VAULT_KDF_ITERATIONS,
): Promise<{ vault: VaultV2Record; dek: Uint8Array }> {
  return encryptVault(vault.mnemonic, vault.address, pin, iterations);
}

export async function rewrapVault(
  vault: VaultV2Record,
  oldPin: string,
  newPin: string,
): Promise<{ vault: VaultV2Record; dek: Uint8Array } | null> {
  const opened = await tryDecryptVault(vault, oldPin);
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
