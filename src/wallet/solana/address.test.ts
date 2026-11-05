import assert from 'node:assert/strict';
import test from 'node:test';

import { checkSolanaRecipient, isOnCurve, isValidSolanaAddress, solanaAddressBytes } from './address';
import { ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID } from './programs';

const WALLET = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
// USDC associated token account of WALLET: a PDA, so it is off the ed25519 curve.
const PDA = '5N3f1tj9v1vc5TUZ8S7mCAnVmjVKrfnzXWhxLaxyZAgt';

test('accepts real Solana addresses and program ids', () => {
  for (const value of [WALLET, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID]) {
    assert.ok(isValidSolanaAddress(value), value);
    assert.equal(solanaAddressBytes(value)?.length, 32);
  }
});

test('rejects EVM addresses, typos, wrong lengths and non-base58 characters', () => {
  for (const value of [
    '',
    '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    WALLET.slice(0, -5),
    `${WALLET}1`,
    WALLET.replace('H', '0'),
    WALLET.replace('k', 'l'),
    'not an address',
  ]) {
    assert.equal(isValidSolanaAddress(value), false, value);
  }
});

test('wallet keys are on the curve, PDAs are not', () => {
  assert.equal(isOnCurve(solanaAddressBytes(WALLET)!), true);
  assert.equal(isOnCurve(solanaAddressBytes(PDA)!), false);
});

test('recipient check explains each failure', () => {
  assert.deepEqual(checkSolanaRecipient(`  ${WALLET} `), { ok: true, address: WALLET, offCurve: false });
  assert.deepEqual(checkSolanaRecipient(PDA), { ok: true, address: PDA, offCurve: true });
  assert.match((checkSolanaRecipient('0x9858EfFD232B4033E47d90003D41EC34EcaEda94') as { message: string }).message, /Ethereum-style/);
  assert.match((checkSolanaRecipient('abc') as { message: string }).message, /not a valid Solana address/);
  assert.match((checkSolanaRecipient(WALLET, WALLET) as { message: string }).message, /your own/);
  assert.match((checkSolanaRecipient('') as { message: string }).message, /Enter a Solana address/);
});
