import * as Crypto from 'expo-crypto';

import { loadPinRecord, savePinRecord, type PinRecord } from './storage';

export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) {
    throw new Error('PIN must be 6 digits');
  }
  const salt = Crypto.randomUUID();
  const hash = await hashPin(pin, salt);
  await savePinRecord({ salt, hash });
}

export async function verifyPin(pin: string): Promise<boolean> {
  if (!isValidPin(pin)) {
    return false;
  }
  const record: PinRecord | null = await loadPinRecord();
  if (!record) {
    return false;
  }
  const hash = await hashPin(pin, record.salt);
  return hash === record.hash;
}
