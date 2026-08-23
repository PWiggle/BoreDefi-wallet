import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkVerificationAnswers,
  deriveAddress,
  isValidMnemonic,
  mnemonicWordCount,
  normalizeMnemonic,
  pickVerificationChallenges,
  walletFromMnemonic,
} from './mnemonic';

const VECTOR =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('normalizes spacing and case', () => {
  assert.equal(normalizeMnemonic('  Abandon\nABANDON, about  '), 'abandon abandon about');
});

test('accepts 12-word BIP39 vectors and rejects junk', () => {
  assert.equal(isValidMnemonic(VECTOR), true);
  assert.equal(isValidMnemonic('not a real seed phrase at all really no'), false);
  assert.equal(mnemonicWordCount(VECTOR), 12);
});

test('derives the standard BIP44 Ethereum account', () => {
  const wallet = walletFromMnemonic(VECTOR);
  assert.equal(wallet.path, "m/44'/60'/0'/0/0");
  assert.equal(deriveAddress(VECTOR), '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
});

test('verification challenges are deterministic with a stub RNG', () => {
  const challenges = pickVerificationChallenges(VECTOR, 3, () => 0);
  assert.deepEqual(
    challenges.map((item) => item.index),
    [0, 1, 2],
  );
  assert.equal(
    checkVerificationAnswers(VECTOR, [
      { index: 0, word: 'abandon' },
      { index: 1, word: 'abandon' },
      { index: 11, word: 'about' },
    ]),
    true,
  );
  assert.equal(checkVerificationAnswers(VECTOR, [{ index: 11, word: 'wrong' }]), false);
});
