import assert from 'node:assert/strict';
import test from 'node:test';
import { Transaction } from 'ethers';

import {
  applyLedgerSignature,
  buildUnsignedLedgerTx,
  detectLedgerTransportKind,
  hexNoPrefix,
  LEDGER_ETH_PATH,
  LEDGER_NATIVE_GAP,
  ledgerGapMessage,
  normalizeLedgerComponent,
} from './ledger';

test('detects no WebHID in Node and documents the native gap', () => {
  assert.equal(detectLedgerTransportKind(), 'unavailable');
  assert.match(ledgerGapMessage() ?? '', /WebHID/);
  assert.match(LEDGER_NATIVE_GAP, /react-native-hw-transport-ble/);
  assert.equal(LEDGER_ETH_PATH, "44'/60'/0'/0/0");
});

test('builds an unsigned EIP-1559 payload and applies a Ledger signature', () => {
  const unsignedHex = buildUnsignedLedgerTx({
    chainId: 1,
    to: '0x1111111111111111111111111111111111111111',
    value: 1n,
    data: '0x',
    nonce: 0,
    gasLimit: 21000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
  });
  assert.equal(unsignedHex.startsWith('0x'), false);
  assert.ok(unsignedHex.length > 20);

  const prepared = Transaction.from(`0x${unsignedHex}`);
  const signedWallet = Transaction.from({
    type: 2,
    chainId: 1,
    nonce: 0,
    to: prepared.to!,
    value: 1n,
    gasLimit: 21000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    signature: {
      r: '0x1111111111111111111111111111111111111111111111111111111111111111',
      s: '0x2222222222222222222222222222222222222222222222222222222222222222',
      v: 28,
    },
  });
  const raw = applyLedgerSignature(unsignedHex, {
    r: '1111111111111111111111111111111111111111111111111111111111111111',
    s: '2222222222222222222222222222222222222222222222222222222222222222',
    v: '1c',
  });
  assert.equal(hexNoPrefix(raw).length > unsignedHex.length, true);
  assert.equal(normalizeLedgerComponent('1'), '01');
  assert.equal(Transaction.from(raw).to, signedWallet.to);
});
