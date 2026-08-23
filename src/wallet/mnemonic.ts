import { HDNodeWallet, Mnemonic, randomBytes } from 'ethers';

export const DEFAULT_PATH = "m/44'/60'/0'/0/0";

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

export function walletFromMnemonic(phrase: string): HDNodeWallet {
  const mnemonic = Mnemonic.fromPhrase(normalizeMnemonic(phrase));
  return HDNodeWallet.fromMnemonic(mnemonic, DEFAULT_PATH);
}

export function deriveAddress(phrase: string): string {
  return walletFromMnemonic(phrase).address;
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
