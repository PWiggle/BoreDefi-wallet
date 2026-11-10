import { ed25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';

import { isValidMnemonic, mnemonicToSeed, normalizeMnemonic } from '../mnemonic';
import { encodeBase58 } from './base58';

/** Phantom, Solflare, Backpack and Solana CLI default: first account, change 0, all hardened. */
export const SOLANA_DEFAULT_PATH = "m/44'/501'/0'/0'";

const HARDENED = 0x80000000;
const ED25519_SEED_KEY = utf8ToBytes('ed25519 seed');

export type SolanaKeypair = {
  /** Base58 public key: the Solana address. */
  address: string;
  publicKey: Uint8Array;
  /** 32-byte ed25519 private seed. Never log, persist, or show this. */
  secretKey: Uint8Array;
};

/** Parses an all-hardened path like m/44'/501'/0'/0'. ed25519 under SLIP-0010 supports hardened steps only. */
export function parseHardenedPath(path: string): number[] {
  const parts = path.trim().split('/');
  if (parts[0] !== 'm') {
    throw new Error('Derivation path must start with m');
  }
  return parts.slice(1).map((part) => {
    const match = /^(\d+)'$/.exec(part);
    if (!match) {
      throw new Error('Solana derivation paths must be fully hardened');
    }
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index >= HARDENED) {
      throw new Error('Derivation index out of range');
    }
    return index + HARDENED;
  });
}

function ser32(index: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, index >>> 0, false);
  return out;
}

/** SLIP-0010 ed25519 private key derivation from a BIP39 seed. Returns the 32-byte private seed. */
export function slip10DeriveEd25519(seed: Uint8Array, path: string): Uint8Array {
  let digest = hmac(sha512, ED25519_SEED_KEY, seed);
  let key = digest.slice(0, 32);
  let chainCode = digest.slice(32);
  for (const index of parseHardenedPath(path)) {
    digest = hmac(sha512, chainCode, concatBytes(new Uint8Array([0]), key, ser32(index)));
    key.fill(0);
    chainCode.fill(0);
    key = digest.slice(0, 32);
    chainCode = digest.slice(32);
  }
  chainCode.fill(0);
  return key;
}

export function keypairFromSecret(secretKey: Uint8Array): SolanaKeypair {
  const publicKey = ed25519.getPublicKey(secretKey);
  return { address: encodeBase58(publicKey), publicKey, secretKey };
}

export function solanaKeypairFromSeed(seed: Uint8Array, path = SOLANA_DEFAULT_PATH): SolanaKeypair {
  return keypairFromSecret(slip10DeriveEd25519(seed, path));
}

// Same in-memory posture as the EVM walletCache in mnemonic.ts: keys live only in this JS process.
const keypairCache = new Map<string, SolanaKeypair>();

export async function solanaKeypairFromMnemonic(phrase: string, path = SOLANA_DEFAULT_PATH): Promise<SolanaKeypair> {
  const normalized = normalizeMnemonic(phrase);
  const cacheKey = `${path}|${normalized}`;
  const cached = keypairCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  if (!isValidMnemonic(normalized)) {
    throw new Error('That recovery phrase is not valid BIP39.');
  }
  const seed = await mnemonicToSeed(normalized);
  const keypair = solanaKeypairFromSeed(seed, path);
  seed.fill(0);
  keypairCache.set(cacheKey, keypair);
  return keypair;
}

export async function deriveSolanaAddress(phrase: string): Promise<string> {
  return (await solanaKeypairFromMnemonic(phrase)).address;
}

/** Drops cached Solana keys (wallet reset). */
export function clearSolanaKeyCache(): void {
  for (const keypair of keypairCache.values()) {
    keypair.secretKey.fill(0);
  }
  keypairCache.clear();
}

export function signSolanaMessage(keypair: SolanaKeypair, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, keypair.secretKey);
}
