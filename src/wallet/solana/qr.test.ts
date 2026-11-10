import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSolanaReceiveUri, parseSolanaPaymentUri } from './qr';

const WALLET = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

test('receive QR uses the Solana Pay scheme', () => {
  assert.equal(buildSolanaReceiveUri(WALLET), `solana:${WALLET}`);
  assert.throws(() => buildSolanaReceiveUri('0x9858EfFD232B4033E47d90003D41EC34EcaEda94'));
});

test('parses raw addresses and transfer requests', () => {
  assert.deepEqual(parseSolanaPaymentUri(` ${WALLET} `), { address: WALLET });
  assert.deepEqual(parseSolanaPaymentUri(`solana:${WALLET}`), { address: WALLET });
  assert.deepEqual(parseSolanaPaymentUri(`solana:${WALLET}?amount=1.5&spl-token=${USDC}&label=Shop`), {
    address: WALLET,
    amount: '1.5',
    splToken: USDC,
  });
});

test('rejects EVM payloads, bad amounts and transaction requests', () => {
  assert.throws(() => parseSolanaPaymentUri('ethereum:0x9858EfFD232B4033E47d90003D41EC34EcaEda94'), /not a Solana address/);
  assert.throws(() => parseSolanaPaymentUri(`solana:${WALLET}?amount=-1`), /invalid amount/);
  assert.throws(() => parseSolanaPaymentUri(`solana:${WALLET}?spl-token=nope`), /invalid token/);
  assert.throws(() => parseSolanaPaymentUri('solana:https%3A%2F%2Fexample.com%2Fpay'), /not supported/);
});
