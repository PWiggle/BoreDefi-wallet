import assert from 'node:assert/strict';
import test from 'node:test';

import { ed25519 } from '@noble/curves/ed25519';

import { mnemonicToSeed } from '../mnemonic';
import {
  deriveSolanaAddress,
  parseHardenedPath,
  signSolanaMessage,
  slip10DeriveEd25519,
  solanaKeypairFromMnemonic,
  solanaKeypairFromSeed,
} from './derive';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Public BIP39 test phrases (never real funds). Expected addresses cross-checked against
// @solana/web3.js Keypair.fromSeed(ed25519-hd-key derivePath(...)) and the address Phantom shows.
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LEGAL = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

test('Phantom-compatible address for the standard test phrase at m/44\'/501\'/0\'/0\'', async () => {
  assert.equal(await deriveSolanaAddress(ABANDON), 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
});

test('second phrase and second account match the reference implementation', async () => {
  assert.equal(await deriveSolanaAddress(LEGAL), 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX');
  assert.equal(
    (await solanaKeypairFromMnemonic(ABANDON, "m/44'/501'/1'/0'")).address,
    'Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb',
  );
});

test('SLIP-0010 ed25519 official test vector 1 (seed 000102…0f)', () => {
  const seed = hexToBytes('000102030405060708090a0b0c0d0e0f');
  assert.equal(bytesToHex(slip10DeriveEd25519(seed, 'm')), '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7');
  assert.equal(
    bytesToHex(slip10DeriveEd25519(seed, "m/0'/1'/2'/2'/1000000000'")),
    '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793',
  );
});

test('same mnemonic normalisation as EVM: spacing and case do not change the address', async () => {
  assert.equal(await deriveSolanaAddress(`  ${ABANDON.toUpperCase().replace(/ /g, '   ')} `), 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
});

test('rejects invalid phrases and non-hardened paths', async () => {
  await assert.rejects(deriveSolanaAddress('abandon abandon abandon'), /not valid BIP39/);
  assert.throws(() => parseHardenedPath("m/44'/501'/0'/0"), /fully hardened/);
  assert.throws(() => parseHardenedPath("44'/501'"), /start with m/);
});

test('signatures verify against the derived public key', async () => {
  const seed = await mnemonicToSeed(LEGAL);
  const keypair = solanaKeypairFromSeed(seed);
  const message = new TextEncoder().encode('boredefi');
  const signature = signSolanaMessage(keypair, message);
  assert.equal(signature.length, 64);
  assert.ok(ed25519.verify(signature, message, keypair.publicKey));
});
