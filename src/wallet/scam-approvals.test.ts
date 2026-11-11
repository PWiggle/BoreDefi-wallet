import assert from 'node:assert/strict';
import test from 'node:test';

import { Interface, MaxUint256 } from 'ethers';

import { decodeApprovalCalldata, decodeTypedApproval, PERMIT2_ADDRESS } from './approval-risk';
import { GoPlusClient } from './security/goplus';
import { localSigningWarning, signingWarning } from './security/scam-warnings';

const IFACE = new Interface([
  'function approve(address spender, uint256 amount)',
  'function increaseAllowance(address spender, uint256 addedValue)',
  'function setApprovalForAll(address operator, bool approved)',
  'function transfer(address to, uint256 amount)',
]);
const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const SPENDER = '0x1111111111111111111111111111111111111111';
const FROM = '0x2222222222222222222222222222222222222222';

const tx = (data: string, to = TOKEN) => [{ from: FROM, to, data }];

test('decoder: unlimited approve (MaxUint256 and uint160/uint96 max sentinels) vs exact amount', () => {
  for (const amount of [MaxUint256, 2n ** 160n - 1n, 2n ** 96n - 1n]) {
    const r = decodeApprovalCalldata(TOKEN, IFACE.encodeFunctionData('approve', [SPENDER, amount]));
    assert.equal(r?.unlimited, true, amount.toString());
    assert.equal(r?.operator, SPENDER);
  }
  const exact = decodeApprovalCalldata(TOKEN, IFACE.encodeFunctionData('approve', [SPENDER, 1_000_000n]));
  assert.equal(exact?.unlimited, false);
  assert.equal(localSigningWarning('eth_sendTransaction', tx(IFACE.encodeFunctionData('approve', [SPENDER, 1_000_000n]))), null);
});

test('warning: unlimited approve / increaseAllowance / setApprovalForAll show the sheet; revoke and transfer do not', () => {
  const unlimited = localSigningWarning('eth_sendTransaction', tx(IFACE.encodeFunctionData('approve', [SPENDER, MaxUint256])));
  assert.equal(unlimited?.title, 'Unlimited token approval');
  assert.equal(unlimited?.canContinue, true);
  assert.equal(unlimited?.spender, SPENDER);
  assert.equal(
    localSigningWarning('eth_sendTransaction', tx(IFACE.encodeFunctionData('increaseAllowance', [SPENDER, MaxUint256])))?.kind,
    'approval',
  );
  const all = localSigningWarning('eth_sendTransaction', tx(IFACE.encodeFunctionData('setApprovalForAll', [SPENDER, true])));
  assert.equal(all?.title, 'Access to a whole NFT collection');
  assert.equal(localSigningWarning('eth_sendTransaction', tx(IFACE.encodeFunctionData('setApprovalForAll', [SPENDER, false]))), null);
  assert.equal(localSigningWarning('eth_sendTransaction', tx(IFACE.encodeFunctionData('transfer', [SPENDER, 5n]))), null);
  assert.equal(localSigningWarning('eth_sendTransaction', [{ to: SPENDER, value: '0x1' }]), null);
});

const permit2Single = (amount: string) => ({
  domain: { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2_ADDRESS },
  primaryType: 'PermitSingle',
  types: {},
  message: { details: { token: TOKEN, amount, expiration: '1', nonce: '0' }, spender: SPENDER, sigDeadline: '1' },
});

test('decoder: Permit2 PermitSingle / PermitBatch and EIP-2612 / DAI permits', () => {
  const single = decodeTypedApproval(permit2Single((2n ** 160n - 1n).toString()));
  assert.equal(single?.unlimited, true);
  assert.equal(single?.operator, SPENDER);
  assert.match(single?.summary ?? '', /Permit2/);
  assert.equal(decodeTypedApproval(permit2Single('1000'))?.unlimited, false);

  const batch = decodeTypedApproval({
    domain: { verifyingContract: PERMIT2_ADDRESS },
    primaryType: 'PermitBatch',
    message: { details: [{ token: TOKEN, amount: '5' }, { token: TOKEN, amount: MaxUint256.toString() }], spender: SPENDER },
  });
  assert.equal(batch?.unlimited, true);
  assert.equal(batch?.operator, SPENDER);

  const eip2612 = decodeTypedApproval(JSON.stringify({
    domain: { verifyingContract: TOKEN },
    primaryType: 'Permit',
    message: { owner: FROM, spender: SPENDER, value: MaxUint256.toString(), nonce: 0, deadline: 1 },
  }));
  assert.equal(eip2612?.unlimited, true);

  const dai = decodeTypedApproval({ primaryType: 'Permit', domain: { verifyingContract: TOKEN }, message: { holder: FROM, spender: SPENDER, allowed: true } });
  assert.equal(dai?.unlimited, true);

  const params = [FROM, JSON.stringify(permit2Single(MaxUint256.toString()))];
  const w = localSigningWarning('eth_signTypedData_v4', params);
  assert.equal(w?.title, 'Unlimited token approval');
  assert.match(w?.summary ?? '', /signature/);
  assert.equal(localSigningWarning('eth_signTypedData_v4', [FROM, JSON.stringify(permit2Single('10'))]), null);
  assert.equal(localSigningWarning('eth_signTypedData_v4', [FROM, '{"primaryType":"Mail","message":{"contents":"hi"}}']), null);
  assert.equal(localSigningWarning('eth_signTypedData_v4', [FROM, '{broken']), null);
});

test('eth_sign of a raw 32-byte hash is a no-continue warning', () => {
  const w = localSigningWarning('eth_sign', [FROM, `0x${'ab'.repeat(32)}`]);
  assert.equal(w?.kind, 'eth_sign');
  assert.equal(w?.canContinue, false);
  assert.match(w?.summary ?? '', /raw hash/);
  assert.equal(localSigningWarning('eth_sign', [FROM, '0x1234'])?.canContinue, false);
  assert.equal(localSigningWarning('personal_sign', ['0x68656c6c6f', FROM]), null);
});

function goplusFake(routes: Record<string, unknown>) {
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => {
    seen.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => (key ? { code: 1, message: 'ok', result: routes[key] } : { code: 2, message: 'none' }) };
  }) as never;
  return { client: new GoPlusClient({ fetchImpl }), seen };
}

test('approval to a GoPlus-flagged spender warns even for an exact amount; clean spender keeps local result', async () => {
  const flagged = goplusFake({ '/address_security/': { stealing_attack: '1', phishing_activities: '1' }, '/approval_security/': { is_contract: 1, is_open_source: 1, doubt_list: 0, malicious_behavior: [] } });
  const exact = await signingWarning({ method: 'eth_sendTransaction', params: tx(IFACE.encodeFunctionData('approve', [SPENDER, 5n])), chainId: 1, client: flagged.client });
  assert.equal(exact?.kind, 'address');
  assert.equal(exact?.severity, 'danger');
  assert.match(exact?.reasons[0] ?? '', /Spender: .*phishing/);

  const unlimited = await signingWarning({ method: 'eth_sendTransaction', params: tx(IFACE.encodeFunctionData('approve', [SPENDER, MaxUint256])), chainId: 1, client: flagged.client });
  assert.equal(unlimited?.kind, 'approval');
  assert.ok(unlimited?.reasons.some((r) => r.startsWith('Spender:')));

  const clean = goplusFake({ '/address_security/': { stealing_attack: '0' }, '/approval_security/': { trust_list: 1, is_contract: 1 } });
  assert.equal(await signingWarning({ method: 'eth_sendTransaction', params: tx(IFACE.encodeFunctionData('approve', [SPENDER, 5n])), chainId: 1, client: clean.client }), null);
});

test('sending to a flagged recipient warns; GoPlus outages fall back to the local result', async () => {
  const flagged = goplusFake({ '/address_security/': { sanctioned: '1' } });
  const w = await signingWarning({ method: 'eth_sendTransaction', params: [{ from: FROM, to: SPENDER, value: '0x1' }], chainId: 8453, client: flagged.client });
  assert.match(w?.reasons[0] ?? '', /Recipient: .*sanctions/);

  const down = new GoPlusClient({ fetchImpl: (async () => { throw new Error('down'); }) as never });
  const local = await signingWarning({ method: 'eth_sendTransaction', params: tx(IFACE.encodeFunctionData('approve', [SPENDER, MaxUint256])), chainId: 1, client: down });
  assert.equal(local?.title, 'Unlimited token approval');
  assert.equal(await signingWarning({ method: 'eth_sendTransaction', params: [{ to: SPENDER, value: '0x1' }], chainId: 1, client: down }), null);
});
