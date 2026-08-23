import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decryptVault,
  encryptVault,
  migrateVaultV1,
  parseStoredVault,
  rewrapVault,
  tryDecryptVault,
  tryOpenVaultWithDek,
  vaultContainsPlainMnemonic,
} from './vault-crypto';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

test('encrypts the mnemonic and decrypts it with the PIN', () => {
  const { vault, dek } = encryptVault(PHRASE, ADDRESS, '123456', 1000);
  assert.equal(vault.version, 2);
  assert.equal(vault.kdf, 'pbkdf2-sha256');
  assert.equal(vault.address, ADDRESS);
  assert.doesNotMatch(JSON.stringify(vault), /abandon/);
  const opened = decryptVault(vault, '123456');
  assert.equal(opened.mnemonic, PHRASE);
  assert.deepEqual(opened.dek, dek);
});

test('wrong PIN cannot decrypt the vault', () => {
  const { vault } = encryptVault(PHRASE, ADDRESS, '123456', 1000);
  assert.equal(tryDecryptVault(vault, '000000'), null);
});

test('migrates a v1 plaintext vault to encrypted v2', () => {
  const v1 = { version: 1 as const, address: ADDRESS, mnemonic: PHRASE };
  assert.equal(vaultContainsPlainMnemonic(v1), true);
  const { vault } = migrateVaultV1(v1, '654321', 1000);
  assert.equal(vault.version, 2);
  assert.equal(vaultContainsPlainMnemonic(vault), false);
  assert.equal(decryptVault(vault, '654321').mnemonic, PHRASE);
  assert.equal(parseStoredVault(v1)?.version, 1);
  assert.equal(parseStoredVault(vault)?.version, 2);
});

test('rewrapping with a new PIN keeps the mnemonic', () => {
  const { vault } = encryptVault(PHRASE, ADDRESS, '111111', 1000);
  const next = rewrapVault(vault, '111111', '222222');
  assert.ok(next);
  assert.equal(tryDecryptVault(vault, '222222'), null);
  assert.equal(decryptVault(next.vault, '222222').mnemonic, PHRASE);
});

test('biometric DEK opens the vault without the PIN', () => {
  const { vault, dek } = encryptVault(PHRASE, ADDRESS, '123456', 1000);
  const opened = tryOpenVaultWithDek(vault, dek);
  assert.equal(opened?.mnemonic, PHRASE);
  const other = encryptVault(PHRASE, ADDRESS, '123456', 1000).dek;
  assert.equal(tryOpenVaultWithDek(vault, other), null);
});
