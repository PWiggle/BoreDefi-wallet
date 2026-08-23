import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyBrowserMethod, normalizeDappUrl, READ_RPC_METHODS, SIGNING_METHODS } from './dapps';

test('normalizes dApp URLs and classifies provider methods', () => {
  assert.equal(normalizeDappUrl('app.uniswap.org'), 'https://app.uniswap.org');
  assert.equal(normalizeDappUrl('https://app.aave.com'), 'https://app.aave.com');
  assert.equal(normalizeDappUrl('wc:abcd@2'), 'wc:abcd@2');
  assert.throws(() => normalizeDappUrl('  '), /URL/);
  assert.equal(READ_RPC_METHODS.has('eth_call'), true);
  assert.equal(SIGNING_METHODS.has('eth_sendTransaction'), true);
  assert.equal(SIGNING_METHODS.has('eth_call'), false);
  assert.equal(classifyBrowserMethod('eth_accounts'), 'accounts');
  assert.equal(classifyBrowserMethod('eth_requestAccounts'), 'connect');
  assert.equal(classifyBrowserMethod('eth_chainId'), 'local');
  assert.equal(classifyBrowserMethod('wallet_getCapabilities'), 'local');
  assert.equal(classifyBrowserMethod('eth_call'), 'read');
  assert.equal(classifyBrowserMethod('personal_sign'), 'sign');
  assert.equal(classifyBrowserMethod('wallet_switchEthereumChain'), 'switch');
  assert.equal(classifyBrowserMethod('foo'), 'unsupported');
});
