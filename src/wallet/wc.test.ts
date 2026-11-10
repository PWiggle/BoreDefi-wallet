import assert from 'node:assert/strict';
import test from 'node:test';

import { isChainId } from './chains';
import {
  caipAccount,
  extractWalletConnectUri,
  isWalletConnectNavigation,
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
  assert.equal(parseSwitchChainId([{ chainId: '0x8173' }]), 33139);
  assert.equal(supportedCaipAccounts('0xabc').length, 8);
  assert.ok(supportedCaipAccounts('0xabc').includes('eip155:33139:0xabc'));
});

test('defaults to the BoreDefi Wallet WalletKit project ID, never the dApp AppKit ID', () => {
  assert.equal(getWalletConnectProjectId(), PUBLIC_WALLETCONNECT_PROJECT_ID);
  assert.equal(PUBLIC_WALLETCONNECT_PROJECT_ID, '5c2313b9c1b69242e695208c052e18a9');
  assert.notEqual(PUBLIC_WALLETCONNECT_PROJECT_ID, 'bbd12489086c59bfdb9e0a49fc05c22f');
  const previous = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;
  process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID = 'bbd12489086c59bfdb9e0a49fc05c22f';
  assert.equal(getWalletConnectProjectId(), PUBLIC_WALLETCONNECT_PROJECT_ID);
  if (previous === undefined) delete process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;
  else process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID = previous;
  assert.equal(WALLETCONNECT_RELAY_ORIGIN, 'https://www.boredefi.com');
  assert.deepEqual(relayWebSocketOptions('wss://relay.walletconnect.org/?projectId=abc'), {
    headers: { Origin: 'https://www.boredefi.com' },
  });
  assert.equal(relayWebSocketOptions('https://example.com'), undefined);
});

test('REGRESSION: WalletConnect links in every shape a page or QR can hand us', () => {
  const uri =
    'wc:7f6e504bfad60b485450578e05678ed3e8e8c4751d3c6160be17160d63ec90f9@2?relay-protocol=irn&symKey=587d5484ce2a2a6ee3ba1962fdd7e8588e06200c46823bd18fbd67def96ad303&expiryTimestamp=1793690000';
  assert.equal(extractWalletConnectUri(uri), uri);
  assert.equal(extractWalletConnectUri(`  ${uri}  `), uri);
  assert.equal(extractWalletConnectUri(uri.replace(/^wc:/, 'WC:')), uri);
  assert.equal(extractWalletConnectUri(encodeURIComponent(uri)), uri);
  assert.equal(extractWalletConnectUri(`boredefi://wc?uri=${encodeURIComponent(uri)}`), uri);
  assert.equal(extractWalletConnectUri(`boredefi://wc?uri=${encodeURIComponent(encodeURIComponent(uri))}`), uri);
  // Unencoded value (its own & and = must survive).
  assert.equal(extractWalletConnectUri(`boredefi://wc?uri=${uri}`), uri);
  assert.equal(extractWalletConnectUri(`https://www.boredefi.com/wc?uri=${encodeURIComponent(uri)}`), uri);
  // Empty / broken hand-offs never reach the pairing screen.
  for (const bad of ['', '   ', 'wc:', 'boredefi://wc', 'boredefi://wc?uri=', 'boredefi://', 'https://www.boredefi.com/connect', undefined, null]) {
    assert.equal(extractWalletConnectUri(bad as string), null, String(bad));
  }
  assert.equal(isWalletConnectNavigation('boredefi://wc?uri='), true);
  assert.equal(isWalletConnectNavigation('wc:abc@2'), true);
  assert.equal(isWalletConnectNavigation('https://app.uniswap.org'), false);
});
