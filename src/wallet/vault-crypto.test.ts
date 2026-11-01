import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import test from 'node:test';

import {
  decryptVault,
  deriveVaultKey,
  deriveVaultKeyNoble,
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

test('OpenSSL PBKDF2-SHA256 matches noble for a fixed vector', async () => {
  // react-native-quick-crypto runs this same OpenSSL PBKDF2. The salt includes
  // a NUL byte so a C-string truncation cannot pass.
  const pin = '135790';
  const salt = Uint8Array.from([0, 1, 2, 0, 255, 16, 32, 64, 128, 7, 9, 11, 13, 15, 17, 19]);
  const iterations = 210_000;
  const noble = deriveVaultKeyNoble(pin, salt, iterations);
  const openssl = pbkdf2Sync(Buffer.from(pin, 'utf8'), Buffer.from(salt), iterations, 32, 'sha256');
  assert.equal(Buffer.from(noble).toString('hex'), openssl.toString('hex'));
  const derived = await deriveVaultKey(pin, salt, iterations);
  assert.equal(Buffer.from(derived).toString('hex'), openssl.toString('hex'));
});

test('encrypts the mnemonic and decrypts it with the PIN', async () => {
  const { vault, dek } = await encryptVault(PHRASE, ADDRESS, '123456', 1000);
  assert.equal(vault.version, 2);
  assert.equal(vault.kdf, 'pbkdf2-sha256');
  assert.equal(vault.address, ADDRESS);
  assert.doesNotMatch(JSON.stringify(vault), /abandon/);
  const opened = await decryptVault(vault, '123456');
  assert.equal(opened.mnemonic, PHRASE);
  assert.deepEqual(opened.dek, dek);
});

test('wrong PIN cannot decrypt the vault', async () => {
  const { vault } = await encryptVault(PHRASE, ADDRESS, '123456', 1000);
  assert.equal(await tryDecryptVault(vault, '000000'), null);
});

test('migrates a v1 plaintext vault to encrypted v2', async () => {
  const v1 = { version: 1 as const, address: ADDRESS, mnemonic: PHRASE };
  assert.equal(vaultContainsPlainMnemonic(v1), true);
  const { vault } = await migrateVaultV1(v1, '654321', 1000);
  assert.equal(vault.version, 2);
  assert.equal(vaultContainsPlainMnemonic(vault), false);
  assert.equal((await decryptVault(vault, '654321')).mnemonic, PHRASE);
  assert.equal(parseStoredVault(v1)?.version, 1);
  assert.equal(parseStoredVault(vault)?.version, 2);
});

test('rewrapping with a new PIN keeps the mnemonic', async () => {
  const { vault } = await encryptVault(PHRASE, ADDRESS, '111111', 1000);
  const next = await rewrapVault(vault, '111111', '222222');
  assert.ok(next);
  assert.equal(await tryDecryptVault(vault, '222222'), null);
  assert.equal((await decryptVault(next.vault, '222222')).mnemonic, PHRASE);
});

test('biometric DEK opens the vault without the PIN', async () => {
  const { vault, dek } = await encryptVault(PHRASE, ADDRESS, '123456', 1000);
  const opened = tryOpenVaultWithDek(vault, dek);
  assert.equal(opened?.mnemonic, PHRASE);
  const other = (await encryptVault(PHRASE, ADDRESS, '123456', 1000)).dek;
  assert.equal(tryOpenVaultWithDek(vault, other), null);
});
