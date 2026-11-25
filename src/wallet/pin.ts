import { isValidPin } from './pin-policy';
import { checkPin, PIN_RECORD_V2, type PinCheck } from './pin-verify';
import { loadPinRecord, loadStoredVault, savePinRecord } from './storage';

export {
  clearedPinLockState,
  formatLockWait,
  isValidPin,
  lockoutMsAfterFailures,
  nextPinLockState,
  remainingLockMs,
} from './pin-policy';
export type { PinCheck } from './pin-verify';

/**
 * Store the PIN marker. No hash of the PIN is kept: the vault (sealed with the PIN through
 * PBKDF2-SHA256 / 210k rounds) is the only way to prove it. Call after saving the new vault.
 */
export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) {
    throw new Error('PIN must be 6 digits');
  }
  await savePinRecord(PIN_RECORD_V2);
}

/**
 * Check a PIN against the stored vault with the slow KDF. On success the opened vault comes back so
 * callers don't derive the key twice. An old fast-hash record is replaced on the first good unlock.
 */
export async function verifyPinAndOpen(pin: string): Promise<PinCheck> {
  if (!isValidPin(pin)) {
    return { ok: false };
  }
  const [vault, record] = await Promise.all([loadStoredVault(), loadPinRecord()]);
  const check = await checkPin(pin, vault, record);
  if (check.ok && check.kind === 'v2' && check.upgradeRecord) {
    await savePinRecord(PIN_RECORD_V2);
  }
  return check;
}
