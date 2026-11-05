import assert from 'node:assert/strict';
import test from 'node:test';

import { bytesToHex } from '@noble/hashes/utils';

import { TOKEN_2022_PROGRAM_ID } from './programs';
import {
  associatedTokenAddress,
  compileMessage,
  createAssociatedTokenAccountIdempotent,
  encodeCompactU16,
  serializeMessage,
  serializeTransaction,
  setComputeUnitLimit,
  setComputeUnitPrice,
  systemTransfer,
  tokenTransferChecked,
} from './tx';

const A = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const B = 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const BLOCKHASH = '9sHcv6xwn9YkB8nxTUGKDwPwNnmqVp5oAXxU8Fdkm4J6';

// Golden bytes. Each was decoded with @solana/web3.js Message.from + Transaction.populate and matched the
// same instructions built with SystemProgram / ComputeBudgetProgram / @solana/spl-token, account for account.
const SOL_MESSAGE_HEX = '01000204f036276246a75b9de3349ed42b15e232f6518fc20f5fcd4f1d64e81f9bd258f7999d46fb3d1256f7049c8ed09314d7268612e8a91b800e91934463848305c98c0306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000000000000000000000000000000000000000000000000000000000000000000083bf53c96cc1deffb04388d1db2a06a9f0898eb9a90611577b062a37a240785b030200050258020000020009031027000000000000030200010c0200000015cd5b0700000000';
const SPL_MESSAGE_HEX = '01000609f036276246a75b9de3349ed42b15e232f6518fc20f5fcd4f1d64e81f9bd258f7f9f5e65acf4b0f79bf3712ae9abc808e40896a4aa1183f053e2a6b82cec1bf8940d2f27c461f29e9feba1ab8acd39496a9c65b0ae62a713f01f941a993bf55ed0306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000999d46fb3d1256f7049c8ed09314d7268612e8a91b800e91934463848305c98cc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61000000000000000000000000000000000000000000000000000000000000000006ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a98c97258f4e2489f1bb3d1029148e0d830b5a1399daff1084048e7bd8dbe9f85983bf53c96cc1deffb04388d1db2a06a9f0898eb9a90611577b062a37a240785b0403000502409c0000030009038813000000000000080600010405060701010704020501000a0ca02526000000000006';

test('compact-u16 encoding matches the Solana shortvec spec', () => {
  assert.deepEqual([...encodeCompactU16(0)], [0]);
  assert.deepEqual([...encodeCompactU16(0x7f)], [0x7f]);
  assert.deepEqual([...encodeCompactU16(0x80)], [0x80, 0x01]);
  assert.deepEqual([...encodeCompactU16(0x3fff)], [0xff, 0x7f]);
  assert.deepEqual([...encodeCompactU16(0x4000)], [0x80, 0x80, 0x01]);
  assert.throws(() => encodeCompactU16(0x10000));
});

test('associated token addresses match @solana/spl-token (Token and Token-2022)', () => {
  assert.equal(associatedTokenAddress(A, USDC), '5N3f1tj9v1vc5TUZ8S7mCAnVmjVKrfnzXWhxLaxyZAgt');
  assert.equal(associatedTokenAddress(B, USDC), 'HpjzXPf8y9CNLxRPZDKFXH7kvKtkfX4BKpxnmsG23vuE');
  assert.equal(associatedTokenAddress(B, PYUSD, TOKEN_2022_PROGRAM_ID), 'De5b5Zxs1eYa7NnH74m29gjoYfKKLRiBvCEaqU69Povn');
});

test('SOL transfer with compute budget serialises to the reference message', () => {
  const message = compileMessage(A, [setComputeUnitLimit(600), setComputeUnitPrice(10_000n), systemTransfer(A, B, 123_456_789n)], BLOCKHASH);
  assert.deepEqual(message.header, { numRequiredSignatures: 1, numReadonlySigned: 0, numReadonlyUnsigned: 2 });
  assert.equal(message.accountKeys[0], A);
  assert.equal(bytesToHex(serializeMessage(message)), SOL_MESSAGE_HEX);
});

test('SPL transferChecked with idempotent ATA creation serialises to the reference message', () => {
  const source = associatedTokenAddress(A, USDC);
  const destination = associatedTokenAddress(B, USDC);
  const message = compileMessage(
    A,
    [
      setComputeUnitLimit(40_000),
      setComputeUnitPrice(5_000n),
      createAssociatedTokenAccountIdempotent(A, destination, B, USDC),
      tokenTransferChecked(source, USDC, destination, A, 2_500_000n, 6),
    ],
    BLOCKHASH,
  );
  // Only the fee payer signs; the owner (same key) is merged into it, writable.
  assert.equal(message.header.numRequiredSignatures, 1);
  assert.equal(bytesToHex(serializeMessage(message)), SPL_MESSAGE_HEX);
});

test('wire transaction prefixes the signature count and rejects bad signatures', () => {
  const msg = new Uint8Array([1, 2, 3]);
  const wire = serializeTransaction([new Uint8Array(64).fill(7)], msg);
  assert.equal(wire.length, 1 + 64 + 3);
  assert.equal(wire[0], 1);
  assert.throws(() => serializeTransaction([new Uint8Array(10)], msg), /64 bytes/);
});

test('builders reject bad inputs', () => {
  assert.throws(
    () => compileMessage(A, [systemTransfer(A, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94', 1n)], BLOCKHASH),
    /Invalid Solana address/,
  );
  assert.throws(() => systemTransfer(A, B, -1n), /u64/);
  assert.throws(() => compileMessage(A, [systemTransfer(A, B, 1n)], 'not-a-blockhash'), /Invalid Solana address/);
  assert.throws(() => tokenTransferChecked(A, USDC, B, A, 1n, 6, A), /Unknown token program/);
});
