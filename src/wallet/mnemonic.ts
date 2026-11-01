import { HDNodeWallet, Mnemonic, randomBytes } from 'ethers';

import { utf8ToBytes } from '@noble/hashes/utils';

import { pbkdf2Async } from './vault-crypto';

export const DEFAULT_PATH = "m/44'/60'/0'/0/0";
export const BIP39_SEED_ITERATIONS = 2048;

const walletCache = new Map<string, HDNodeWallet>();

export function normalizeMnemonic(phrase: string): string {
  return phrase
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .join(' ');
}

export function mnemonicWordCount(phrase: string): number {
  const words = normalizeMnemonic(phrase).split(' ');
  return words[0] ? words.length : 0;
}

export function isValidMnemonic(phrase: string): boolean {
  try {
    const normalized = normalizeMnemonic(phrase);
    const count = mnemonicWordCount(normalized);
    if (count !== 12 && count !== 24) {
      return false;
    }
    Mnemonic.fromPhrase(normalized);
    return true;
  } catch {
    return false;
  }
}

export function generateMnemonic(wordCount: 12 | 24 = 12): string {
  const entropy = randomBytes(wordCount === 24 ? 32 : 16);
  return Mnemonic.fromEntropy(entropy).phrase;
}

/**
 * BIP39 mnemonicToSeed: PBKDF2-SHA512, 2048 iterations, 64 bytes.
 * On device this is native OpenSSL. The phrase and salt are NFKD, matching the spec.
 */
export async function mnemonicToSeed(phrase: string, password = ''): Promise<Uint8Array> {
  const normalized = normalizeMnemonic(phrase).normalize('NFKD');
  const salt = utf8ToBytes(`mnemonic${password.normalize('NFKD')}`);
  return pbkdf2Async(utf8ToBytes(normalized), salt, BIP39_SEED_ITERATIONS, 64, 'sha512');
}

export async function walletFromMnemonic(phrase: string): Promise<HDNodeWallet> {
  const normalized = normalizeMnemonic(phrase);
  const cached = walletCache.get(normalized);
  if (cached) {
    return cached;
  }
  if (!isValidMnemonic(normalized)) {
    throw new Error('That recovery phrase is not valid BIP39.');
  }
  const seed = await mnemonicToSeed(normalized);
  const wallet = HDNodeWallet.fromSeed(seed).derivePath(DEFAULT_PATH);
  walletCache.set(normalized, wallet);
  return wallet;
}

export async function deriveAddress(phrase: string): Promise<string> {
  return (await walletFromMnemonic(phrase)).address;
}

export type WordChallenge = {
  index: number;
  word: string;
};

export function pickVerificationChallenges(
  phrase: string,
  count = 3,
  random: () => number = Math.random,
): WordChallenge[] {
  const words = normalizeMnemonic(phrase).split(' ');
  if (words.length < count) {
    throw new Error('Mnemonic is too short to verify');
  }
  const indices = words.map((_, index) => index);
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(random() * (indices.length - i));
    const current = indices[i];
    const swap = indices[j];
    if (current === undefined || swap === undefined) {
      throw new Error('Failed to pick verification words');
    }
    indices[i] = swap;
    indices[j] = current;
  }
  return indices
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((index) => {
      const word = words[index];
      if (word === undefined) {
        throw new Error('Missing verification word');
      }
      return { index, word };
    });
}

export function checkVerificationAnswers(
  phrase: string,
  answers: Array<{ index: number; word: string }>,
): boolean {
  const words = normalizeMnemonic(phrase).split(' ');
  if (answers.length === 0) {
    return false;
  }
  return answers.every((answer) => words[answer.index] === normalizeMnemonic(answer.word));
}
