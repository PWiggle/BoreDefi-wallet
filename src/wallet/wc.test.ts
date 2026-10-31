import assert from 'node:assert/strict';
import test from 'node:test';

import { isChainId } from './chains';
import {
  caipAccount,
  extractWalletConnectUri,
  getWalletConnectProjectId,
  hexToUtf8,
  parseCaipChainId,
  parseSwitchChainId,
  pickSignMessage,
  PUBLIC_WALLETCONNECT_PROJECT_ID,
  relayWebSocketOptions,
  WALLETCONNECT_RELAY_ORIGIN,
  supportedCaipAccounts,
} from './wc';

test('supports the Phase 2 EVM set', () => {
  for (const id of [1, 10, 56, 137, 8453, 42161, 43114]) {
    assert.equal(isChainId(id), true);
  }
  assert.equal(isChainId(999), false);
});

test('parses WalletConnect URIs from raw and deep links', () => {
  const uri = 'wc:abcd@2?relay-protocol=irn&symKey=ff';
  assert.equal(extractWalletConnectUri(uri), uri);
  assert.equal(
    extractWalletConnectUri(`boredefi://wc?uri=${encodeURIComponent(uri)}`),
    uri,
  );
  assert.equal(extractWalletConnectUri('0xabc'), null);
});

test('builds CAIP identifiers and decodes hex messages', () => {
  assert.equal(
    caipAccount(1, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'),
    'eip155:1:0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
  );
  assert.equal(parseCaipChainId('eip155:8453'), 8453);
  assert.equal(parseCaipChainId('0xa4b1'), 42161);
  assert.equal(hexToUtf8('0x68656c6c6f'), 'hello');
  assert.equal(pickSignMessage(['0x68656c6c6f', '0x9858EfFD232B4033E47d90003D41EC34EcaEda94']), '0x68656c6c6f');
  assert.equal(parseSwitchChainId([{ chainId: '0x2105' }]), 8453);
  assert.equal(supportedCaipAccounts('0xabc').length, 7);
});

test('defaults to the live public WalletConnect project ID', () => {
  assert.equal(getWalletConnectProjectId(), PUBLIC_WALLETCONNECT_PROJECT_ID);
  assert.equal(PUBLIC_WALLETCONNECT_PROJECT_ID, 'c884e13aaa967e608946ee76f636f27b');
  assert.equal(WALLETCONNECT_RELAY_ORIGIN, 'https://boredefi.money');
  assert.deepEqual(relayWebSocketOptions('wss://relay.walletconnect.org/?projectId=abc'), {
    headers: { Origin: 'https://boredefi.money' },
  });
  assert.equal(relayWebSocketOptions('https://example.com'), undefined);
});
