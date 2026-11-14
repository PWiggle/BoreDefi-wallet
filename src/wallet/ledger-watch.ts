/**
 * Watch-only Ledger account: the public addresses (and Bluetooth device id/name) of a paired Nano X, saved so the
 * Ledger account and its balances show in the app without the device. Signing always needs the Ledger itself; the
 * keys never leave it, and nothing secret is stored here.
 */
import { getAddress } from 'ethers';

import { isValidSolanaAddress } from './solana/address';

export type LedgerWatchAccount = {
  version: 1;
  ethAddress: string;
  ethPath: string;
  solanaAddress: string | null;
  solanaPath: string | null;
  deviceId: string | null;
  deviceName: string | null;
  /** ISO time the user last verified the addresses on the device screen, if ever. */
  verifiedAt: string | null;
  savedAt: string;
};

function cleanString(value: unknown, max = 128): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

/** Validates a stored record; anything malformed (or a wrong checksum) is dropped. Pure. */
export function normalizeLedgerWatch(raw: unknown): LedgerWatchAccount | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || typeof r.ethAddress !== 'string') {
    return null;
  }
  let ethAddress: string;
  try {
    ethAddress = getAddress(r.ethAddress);
  } catch {
    return null;
  }
  const solanaAddress = cleanString(r.solanaAddress, 64);
  return {
    version: 1,
    ethAddress,
    ethPath: cleanString(r.ethPath, 64) ?? "44'/60'/0'/0/0",
    solanaAddress: solanaAddress && isValidSolanaAddress(solanaAddress) ? solanaAddress : null,
    solanaPath: cleanString(r.solanaPath, 64),
    deviceId: cleanString(r.deviceId),
    deviceName: cleanString(r.deviceName),
    verifiedAt: cleanString(r.verifiedAt, 40),
    savedAt: cleanString(r.savedAt, 40) ?? new Date(0).toISOString(),
  };
}

export function ledgerWatchFromSession(session: {
  ethAddress: string;
  ethPath: string;
  solanaAddress: string | null;
  solanaPath: string;
  deviceId: string;
  deviceName: string;
}, previous: LedgerWatchAccount | null, now = new Date()): LedgerWatchAccount {
  const sameAccount = previous?.ethAddress.toLowerCase() === session.ethAddress.toLowerCase();
  return {
    version: 1,
    ethAddress: getAddress(session.ethAddress),
    ethPath: session.ethPath,
    // Keep a previously read Solana address if the Solana app wasn't open this time.
    solanaAddress: session.solanaAddress ?? (sameAccount ? previous?.solanaAddress ?? null : null),
    solanaPath: session.solanaAddress || (sameAccount && previous?.solanaAddress) ? session.solanaPath : null,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    verifiedAt: sameAccount ? previous?.verifiedAt ?? null : null,
    savedAt: now.toISOString(),
  };
}
