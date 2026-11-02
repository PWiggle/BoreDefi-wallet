import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyBrowserMethod,
  CONNECT_DEMO_URL,
  DAPP_BOOKMARKS,
  DEFAULT_BROWSER_URL,
  normalizeDappUrl,
  dappHost,
  dappOrigin,
  urlBarAfterNavigation,
  READ_RPC_METHODS,
  SIGNING_METHODS,
} from './dapps';

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
  assert.equal(classifyBrowserMethod('wallet_revokePermissions'), 'disconnect');
  assert.equal(classifyBrowserMethod('foo'), 'unsupported');
  assert.equal(DEFAULT_BROWSER_URL, 'https://app.uniswap.org');
  assert.equal(CONNECT_DEMO_URL, 'https://www.boredefi.com/connect');
  assert.equal(
    DAPP_BOOKMARKS.some((item) => item.name === 'Connect' && item.url === CONNECT_DEMO_URL),
    true,
  );
  assert.equal(
    DAPP_BOOKMARKS.some((item) => item.name === 'BoreDash' && item.url === 'https://www.boredash.com'),
    true,
  );
});

test('URL bar and prompt origin follow redirects to the page actually loaded', () => {
  const typed = 'https://pwiggle.github.io/BoreDefi-wallet/connect/';
  const loaded = 'https://www.boredefi.com/connect';
  assert.equal(urlBarAfterNavigation(typed, loaded, false), loaded);
  // Never overwrite what the user is typing.
  assert.equal(urlBarAfterNavigation('app.unis', loaded, true), 'app.unis');
  // Ignore non-web states such as about:blank during a redirect.
  assert.equal(urlBarAfterNavigation(loaded, 'about:blank', false), loaded);
  assert.equal(urlBarAfterNavigation(loaded, undefined, false), loaded);

  assert.equal(dappOrigin(loaded), 'https://www.boredefi.com');
  assert.equal(dappHost(loaded), 'www.boredefi.com');
  assert.notEqual(dappOrigin(typed), dappOrigin(loaded));
  assert.equal(dappOrigin('http://10.0.2.2:8765/?a=1'), 'http://10.0.2.2:8765');
  assert.equal(dappHost('http://10.0.2.2:8765/'), '10.0.2.2:8765');
  assert.equal(dappOrigin('wc:abc@2?relay-protocol=irn'), null);
  assert.equal(dappOrigin('javascript:alert(1)'), null);
  assert.equal(dappOrigin('not a url'), null);
  // Look-alike hosts are different origins.
  assert.notEqual(dappOrigin('https://www.boredefi.com.evil.io/connect'), dappOrigin(loaded));
});
