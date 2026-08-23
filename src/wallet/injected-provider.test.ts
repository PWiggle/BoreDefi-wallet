import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chainIdHex,
  INJECTED_PROVIDER_SOURCE,
  providerEmitScript,
  providerResolveScript,
  providerSyncScript,
} from './injected-provider';

test('builds injected provider helper scripts', () => {
  assert.equal(chainIdHex(8453), '0x2105');
  assert.match(providerResolveScript(3, ['0xabc']), /__boredefiResolve\(3/);
  assert.match(providerResolveScript(3, null, 'nope'), /"nope"/);
  assert.match(providerEmitScript('chainChanged', '0x1'), /chainChanged/);
  assert.match(providerSyncScript('0xabc', 1), /selectedAddress/);
});

test('injected provider announces BoreDefi over EIP-6963', () => {
  assert.match(INJECTED_PROVIDER_SOURCE, /isBoreDefi:\s*true/);
  assert.match(INJECTED_PROVIDER_SOURCE, /eip6963:announceProvider/);
  assert.match(INJECTED_PROVIDER_SOURCE, /com\.boredefi\.wallet/);
});
