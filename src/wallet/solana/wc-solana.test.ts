import assert from 'node:assert/strict';
import test from 'node:test';

import { ed25519 } from '@noble/curves/ed25519';
import { base64 } from '@scure/base';

import { decodeBase58, encodeBase58 } from './base58';
import { keypairFromSecret, signSolanaMessage } from './derive';
import { SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID } from './programs';
import { compileMessage, serializeMessage, serializeTransaction, systemTransfer, type Instruction } from './tx';
import {
  SOLANA_DEVNET_CAIP,
  SOLANA_MAINNET_CAIP,
  decodeSignableMessage,
  parseSolanaTransaction,
  reviewSolanaTransaction,
  signSolanaWcMessage,
  signSolanaWcTransaction,
  solanaWcChains,
} from './wc-solana';

// Throwaway test keys (fixed bytes). Never a real wallet.
const ME = keypairFromSecret(new Uint8Array(32).fill(1));
const OTHER = keypairFromSecret(new Uint8Array(32).fill(2));
const BLOCKHASH = encodeBase58(new Uint8Array(32).fill(7));
const sign = (bytes: Uint8Array) => signSolanaMessage(ME, bytes);

function unsignedTx(instructions: Instruction[], feePayer = ME.address): Uint8Array {
  const message = serializeMessage(compileMessage(feePayer, instructions, BLOCKHASH));
  const header = compileMessage(feePayer, instructions, BLOCKHASH).header.numRequiredSignatures;
  return serializeTransaction(Array.from({ length: header }, () => new Uint8Array(64)), message);
}

test('Solana WC chains follow the build cluster', () => {
  assert.ok(solanaWcChains('mainnet-beta').includes(SOLANA_MAINNET_CAIP));
  assert.deepEqual(solanaWcChains('devnet'), [SOLANA_DEVNET_CAIP]);
});

test('solana_signTransaction signs the message bytes in our signer slot and returns the signed wire', () => {
  const wire = unsignedTx([systemTransfer(ME.address, OTHER.address, 1_500_000n)]);
  const out = signSolanaWcTransaction({ transaction: base64.encode(wire) }, ME.address, sign);
  const signed = parseSolanaTransaction(base64.decode(out.transaction));
  assert.equal(encodeBase58(signed.signatures[0]), out.signature);
  assert.ok(ed25519.verify(decodeBase58(out.signature), signed.messageBytes, ME.publicKey));
  // Message untouched.
  assert.deepEqual(signed.messageBytes, parseSolanaTransaction(wire).messageBytes);
  // Older dApps send base58.
  const legacy = signSolanaWcTransaction({ transaction: encodeBase58(wire) }, ME.address, sign);
  assert.equal(legacy.signature, out.signature);
});

test('plain SOL transfer reads as a send, not danger', () => {
  const tx = parseSolanaTransaction(unsignedTx([systemTransfer(ME.address, OTHER.address, 1_500_000n)]));
  const review = reviewSolanaTransaction(tx, ME.address);
  assert.equal(review.danger, false);
  assert.match(review.summary, /Sends 0\.0015 SOL/);
  assert.equal(review.feePayerIsWallet, true);
});

test('drainer red flags: System Assign of the wallet, token Approve, SetAuthority', () => {
  const assign: Instruction = {
    programId: SYSTEM_PROGRAM_ID,
    accounts: [{ address: ME.address, isSigner: true, isWritable: true }],
    data: Uint8Array.from([1, 0, 0, 0, ...new Uint8Array(32).fill(9)]),
  };
  const approve: Instruction = {
    programId: TOKEN_PROGRAM_ID,
    accounts: [
      { address: OTHER.address, isSigner: false, isWritable: true },
      { address: OTHER.address, isSigner: false, isWritable: false },
      { address: ME.address, isSigner: true, isWritable: false },
    ],
    data: Uint8Array.from([4, 255, 255, 255, 255, 255, 255, 255, 255]),
  };
  const setAuthority: Instruction = { ...approve, data: Uint8Array.from([6, 2, 1, ...new Uint8Array(32).fill(3)]) };
  for (const [ix, pattern] of [
    [assign, /Assigns your wallet/],
    [approve, /Token approval/],
    [setAuthority, /SetAuthority/],
  ] as const) {
    const review = reviewSolanaTransaction(parseSolanaTransaction(unsignedTx([ix])), ME.address);
    assert.equal(review.danger, true, String(pattern));
    assert.ok(review.warnings.some((w) => pattern.test(w)));
  }
});

test('unknown programs are named; v0 transactions with lookup tables parse', () => {
  const programKey = OTHER.publicKey;
  // v0: prefix 0x80, header [1,0,1], 2 static keys, blockhash, 1 ix (program idx 1, accounts [0, 2(lookup)]), 1 lookup table.
  const message = Uint8Array.from([
    0x80, 1, 0, 1, 2, ...ME.publicKey, ...programKey, ...decodeBase58(BLOCKHASH),
    1, 1, 2, 0, 2, 1, 0xaa,
    1, ...new Uint8Array(32).fill(5), 1, 0, 0,
  ]);
  const wire = serializeTransaction([new Uint8Array(64)], message);
  const tx = parseSolanaTransaction(wire);
  assert.equal(tx.version, 0);
  assert.equal(tx.lookupTables, 1);
  assert.equal(tx.instructions[0].accounts[1], null);
  const review = reviewSolanaTransaction(tx, ME.address);
  assert.ok(review.warnings.some((w) => w.includes(OTHER.address)));
  assert.ok(review.warnings.some((w) => /lookup tables/.test(w)));
  const out = signSolanaWcTransaction({ transaction: base64.encode(wire) }, ME.address, sign);
  assert.ok(ed25519.verify(decodeBase58(out.signature), message, ME.publicKey));
});

test('refuses transactions that do not need our signature, malformed wires and the old JSON format', () => {
  const wire = unsignedTx([systemTransfer(OTHER.address, ME.address, 1n)], OTHER.address);
  assert.throws(() => signSolanaWcTransaction({ transaction: base64.encode(wire) }, ME.address, sign), /does not need your wallet/);
  assert.throws(() => signSolanaWcTransaction({ transaction: 'AAAA' }, ME.address, sign), /could not be read/);
  assert.throws(() => signSolanaWcTransaction({ feePayer: ME.address, instructions: [] }, ME.address, sign), /old format/);
  const truncated = wire.slice(0, wire.length - 3);
  assert.throws(() => parseSolanaTransaction(truncated));
});

test('solana_signMessage signs readable text only', () => {
  const text = 'Sign in to example.com\nNonce: 42';
  const message = encodeBase58(new TextEncoder().encode(text));
  const out = signSolanaWcMessage({ message, pubkey: ME.address }, ME.address, sign);
  assert.ok(ed25519.verify(decodeBase58(out.signature), new TextEncoder().encode(text), ME.publicKey));
  assert.equal(decodeSignableMessage(message).text, text);
  assert.throws(() => signSolanaWcMessage({ message, pubkey: OTHER.address }, ME.address, sign), /different Solana account/);
  // A transaction message disguised as a "message" must never be signed.
  const txMessage = parseSolanaTransaction(unsignedTx([systemTransfer(ME.address, OTHER.address, 1n)])).messageBytes;
  assert.throws(() => signSolanaWcMessage({ message: encodeBase58(txMessage) }, ME.address, sign), /Blocked/);
  assert.throws(() => signSolanaWcMessage({ message: encodeBase58(Uint8Array.from([0xff, 0xfe, 0x00])) }, ME.address, sign), /Blocked/);
  assert.throws(() => signSolanaWcMessage({}, ME.address, sign), /missing a message/);
});
