import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import test from 'node:test';

import {
  checkVerificationAnswers,
  deriveAddress,
  isValidMnemonic,
  mnemonicToSeed,
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

test('BIP39 seed matches OpenSSL PBKDF2-SHA512', async () => {
  const phrase = VECTOR.normalize('NFKD');
  const openssl = pbkdf2Sync(Buffer.from(phrase, 'utf8'), Buffer.from('mnemonic', 'utf8'), 2048, 64, 'sha512');
  const seed = await mnemonicToSeed(VECTOR);
  assert.equal(Buffer.from(seed).toString('hex'), openssl.toString('hex'));
  assert.equal(
    openssl.toString('hex'),
    '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4',
  );
});

test('derives the standard BIP44 Ethereum account', async () => {
  const wallet = await walletFromMnemonic(VECTOR);
  assert.equal(wallet.path, "m/44'/60'/0'/0/0");
  assert.equal(await deriveAddress(VECTOR), '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
});

test('hardhat test mnemonic derives the known address', async () => {
  const phrase = 'test test test test test test test test test test test junk';
  assert.equal(await deriveAddress(phrase), '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
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
