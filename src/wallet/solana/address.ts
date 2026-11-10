import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';

import { decodeBase58, encodeBase58 } from './base58';

export const SOLANA_ADDRESS_LENGTH = 32;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Decodes a base58 Solana address to its 32 bytes, or null when it is not one. */
export function solanaAddressBytes(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (!BASE58_RE.test(trimmed)) {
    return null;
  }
  try {
    const bytes = decodeBase58(trimmed);
    if (bytes.length !== SOLANA_ADDRESS_LENGTH) {
      return null;
    }
    // Reject non-canonical encodings (leading-zero tricks) so the shown string is the address.
    return encodeBase58(bytes) === trimmed ? bytes : null;
  } catch {
    return null;
  }
}

export function isValidSolanaAddress(value: string): boolean {
  return solanaAddressBytes(value) !== null;
}

/** True when the 32 bytes are a point on the ed25519 curve, i.e. a key a wallet can sign for. */
export function isOnCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(bytes);
    return true;
  } catch {
    return false;
  }
}

export type SolanaAddressCheck =
  | { ok: true; address: string; offCurve: boolean }
  | { ok: false; message: string };

/**
 * Validates a recipient typed or pasted on the Solana Send screen.
 * Off-curve addresses (program-derived accounts) are flagged: nobody holds a key for them, so tokens sent
 * there are usually lost unless the user knows the program.
 */
export function checkSolanaRecipient(value: string, from?: string): SolanaAddressCheck {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, message: 'Enter a Solana address.' };
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return { ok: false, message: 'That is an Ethereum-style 0x address. Solana addresses look like 7xKX…' };
  }
  const bytes = solanaAddressBytes(trimmed);
  if (!bytes) {
    return { ok: false, message: 'That is not a valid Solana address.' };
  }
  if (from && trimmed === from) {
    return { ok: false, message: 'That is your own Solana address.' };
  }
  return { ok: true, address: trimmed, offCurve: !isOnCurve(bytes) };
}

const PDA_MARKER = utf8ToBytes('ProgramDerivedAddress');

/** Solana findProgramAddress: highest bump (255 down) whose hash lands off the curve. */
export function findProgramAddress(seeds: Uint8Array[], programId: Uint8Array): { address: Uint8Array; bump: number } {
  for (const seed of seeds) {
    if (seed.length > 32) {
      throw new Error('PDA seed too long');
    }
  }
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = sha256(concatBytes(...seeds, new Uint8Array([bump]), programId, PDA_MARKER));
    if (!isOnCurve(hash)) {
      return { address: hash, bump };
    }
  }
  throw new Error('No program address found');
}
