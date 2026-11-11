import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import { isValidPin } from './pin-policy';
import { tryDecryptVault, type OpenVault, type StoredVault, type VaultV1Record } from './vault-crypto';

/**
 * PIN record kept next to the vault.
 * - v2 (current): a marker only. No hash is stored; the PIN is proven by unwrapping the vault key with
 *   the slow KDF (PBKDF2-SHA256, 210k rounds), so a copy of SecureStore gives no fast PIN check.
 * - legacy: { salt, hash } where hash = SHA256(`${salt}:${pin}`). Read only to open a very old v1
 *   (plaintext) vault once before it is re-encrypted; dropped on the first successful unlock.
 */
export type PinRecordV2 = { version: 2; scheme: 'vault-kdf' };
export type LegacyPinRecord = { salt: string; hash: string };
export type PinRecord = PinRecordV2 | LegacyPinRecord;

export const PIN_RECORD_V2: PinRecordV2 = { version: 2, scheme: 'vault-kdf' };

export function isPinRecordV2(record: unknown): record is PinRecordV2 {
  return Boolean(
    record &&
      typeof record === 'object' &&
      (record as PinRecordV2).version === 2 &&
      (record as PinRecordV2).scheme === 'vault-kdf',
  );
}

export function isLegacyPinRecord(record: unknown): record is LegacyPinRecord {
  return Boolean(
    record &&
      typeof record === 'object' &&
      typeof (record as LegacyPinRecord).salt === 'string' &&
      typeof (record as LegacyPinRecord).hash === 'string',
  );
}

/** Old fast hash. Same output as expo-crypto SHA256 hex of `${salt}:${pin}`. Legacy reads only. */
export function legacyPinHash(pin: string, salt: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${salt}:${pin}`)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export type PinCheck =
  | { ok: false }
  /** v2 vault opened with the PIN. `upgradeRecord` = an old fast hash is still stored and must be replaced. */
  | { ok: true; kind: 'v2'; opened: OpenVault; upgradeRecord: boolean }
  /** Old plaintext v1 vault; the caller must re-encrypt it and store PIN_RECORD_V2. */
  | { ok: true; kind: 'v1'; vault: VaultV1Record };

/**
 * The only PIN check. v2 vaults: a successful slow-KDF decrypt. v1 vaults (pre-encryption installs):
 * the legacy hash, once, so those users are not locked out; the caller migrates them to v2 right away.
 */
export async function checkPin(
  pin: string,
  vault: StoredVault | null,
  record: unknown,
): Promise<PinCheck> {
  if (!isValidPin(pin) || !vault || !record) {
    return { ok: false };
  }
  if (vault.version === 2) {
    const opened = await tryDecryptVault(vault, pin);
    if (!opened) {
      return { ok: false };
    }
    return { ok: true, kind: 'v2', opened, upgradeRecord: !isPinRecordV2(record) };
  }
  if (!isLegacyPinRecord(record)) {
    return { ok: false };
  }
  if (!constantTimeEqual(legacyPinHash(pin, record.salt), record.hash.toLowerCase())) {
    return { ok: false };
  }
  return { ok: true, kind: 'v1', vault };
}
