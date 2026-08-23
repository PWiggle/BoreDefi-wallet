import assert from 'node:assert/strict';
import test from 'node:test';

import { chainIdHex, providerEmitScript, providerResolveScript, providerSyncScript } from './injected-provider';

test('builds injected provider helper scripts', () => {
  assert.equal(chainIdHex(8453), '0x2105');
  assert.match(providerResolveScript(3, ['0xabc']), /__boredefiResolve\(3/);
  assert.match(providerResolveScript(3, null, 'nope'), /"nope"/);
  assert.match(providerEmitScript('chainChanged', '0x1'), /chainChanged/);
  assert.match(providerSyncScript('0xabc', 1), /selectedAddress/);
});
