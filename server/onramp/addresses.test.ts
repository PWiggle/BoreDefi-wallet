import assert from 'node:assert/strict';
import test from 'node:test';

import { addressMatchesFamily, isEvmAddress, isSolanaAddress } from './addresses';

const EVM = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const SOL_OTHER = 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX';
const SOL_EXAMPLE = 'bufoH37MTiMTNAfBS4VEZ94dCEwMsmeSijD2vZRShuV';

test('accepts an Ethereum-style address in any hex case and rejects junk', () => {
  assert.equal(isEvmAddress(EVM), true);
  assert.equal(isEvmAddress(EVM.toUpperCase().replace('0X', '0x')), true);
  assert.equal(isEvmAddress(`0x${'ab'.repeat(20)}`), true);
  for (const value of ['', '0x1234', EVM.slice(0, -1), `${EVM}ff`, '0x0000000000000000000000000000000000000000', SOL, 'not an address']) {
    assert.equal(isEvmAddress(value), false, value);
  }
});

test('accepts a canonical Solana address and rejects EVM, PDAs-length junk, and the system program', () => {
  assert.equal(isSolanaAddress(SOL), true);
  assert.equal(isSolanaAddress(SOL_OTHER), true);
  assert.equal(isSolanaAddress(SOL_EXAMPLE), true);
  assert.equal(isSolanaAddress('1'.repeat(32)), false);
  assert.equal(addressMatchesFamily(SOL, 'solana'), true);
  assert.equal(addressMatchesFamily(EVM, 'evm'), true);
  assert.equal(addressMatchesFamily(EVM, 'solana'), false);
  assert.equal(addressMatchesFamily(SOL, 'evm'), false);
  for (const value of ['', 'short', `${SOL}1`, EVM, '1'.repeat(32), SOL.replace('H', '0'), `${SOL.slice(0, -1)}0`]) {
    assert.equal(isSolanaAddress(value), false, value);
  }
});
