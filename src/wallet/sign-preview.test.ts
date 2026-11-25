import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeBase58 } from './solana/base58';
import { describeSignRequest } from './sign-preview';

const ME = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

function utf8Hex(text: string): string {
  return `0x${Buffer.from(text, 'utf8').toString('hex')}`;
}

test('personal_sign shows the decoded message text', () => {
  const preview = describeSignRequest('personal_sign', [utf8Hex('Sign in to Example\nNonce: 42'), ME]);
  assert.ok(preview);
  assert.equal(preview.summary, 'Message signature');
  assert.equal(preview.rows[0]?.label, 'Message');
  assert.match(preview.rows[0]?.value ?? '', /Sign in to Example/);
  assert.match(preview.rows[0]?.value ?? '', /Nonce: 42/);
  assert.equal(preview.danger, false);
});

test('personal_sign with binary data is flagged, not shown as text', () => {
  const preview = describeSignRequest('personal_sign', [`0x${'00ff'.repeat(16)}`, ME]);
  assert.ok(preview?.danger);
  assert.equal(preview?.rows[0]?.label, 'Message (hex)');
});

test('personal_sign links are neutralized', () => {
  const preview = describeSignRequest('personal_sign', [utf8Hex('Claim at https://evil.xyz/drain'), ME]);
  assert.doesNotMatch(preview?.rows[0]?.value ?? '', /https:\/\//);
});

const permit = {
  types: {
    EIP712Domain: [{ name: 'name', type: 'string' }],
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Permit',
  domain: { name: 'USD Coin', version: '2', chainId: 1, verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  message: { owner: ME, spender: '0x1111111111111111111111111111111111111111', value: '1000000', nonce: 0, deadline: 9999999999 },
};

test('eth_signTypedData_v4 shows domain, type, fields, and a permit warning', () => {
  const preview = describeSignRequest('eth_signTypedData_v4', [ME, JSON.stringify(permit)], 1);
  assert.ok(preview);
  assert.equal(preview.summary, 'Typed data: Permit');
  const byLabel = Object.fromEntries(preview.rows.map((r) => [r.label, r.value]));
  assert.equal(byLabel['Signing for'], 'USD Coin (v2)');
  assert.equal(byLabel.Contract, permit.domain.verifyingContract);
  assert.match(byLabel['Signature chain'] ?? '', /Ethereum/);
  assert.equal(byLabel.spender, permit.message.spender);
  assert.equal(byLabel.value, '1000000');
  assert.ok(preview.danger);
  assert.ok(preview.warnings.some((w) => /permit/i.test(w)));
});

test('typed data for another chain warns', () => {
  const preview = describeSignRequest('eth_signTypedData_v4', [ME, JSON.stringify(permit)], 8453);
  assert.ok(preview?.warnings.some((w) => /different network/.test(w)));
});

test('typed data accepts an object payload and nested fields', () => {
  const order = {
    domain: { name: 'Seaport', chainId: '0x1' },
    primaryType: 'OrderComponents',
    message: { offerer: ME, offer: [{ token: '0xabc', amount: '1' }] },
  };
  const preview = describeSignRequest('eth_signTypedData_v4', [ME, order], 1);
  assert.ok(preview?.rows.some((r) => r.label === 'offer[0].token'));
  assert.ok(preview?.warnings.some((w) => /Marketplace order/.test(w)));
});

test('unreadable typed data is dangerous and says so', () => {
  const preview = describeSignRequest('eth_signTypedData_v4', [ME, '{not json']);
  assert.ok(preview?.danger);
  assert.match(preview?.summary ?? '', /could not be read/);
});

test('eth_sign is shown as blocked', () => {
  assert.match(describeSignRequest('eth_sign', [ME, '0x00'])?.summary ?? '', /Blocked/);
});

test('Solana signMessage shows the text', () => {
  const message = encodeBase58(new TextEncoder().encode('Sign in to Mevvy'));
  const preview = describeSignRequest('solana_signMessage', [{ message, pubkey: 'x' }]);
  assert.equal(preview?.rows[0]?.value, 'Sign in to Mevvy');
  assert.equal(preview?.danger, false);
});

test('transactions show call data, plain sends show nothing extra', () => {
  const call = describeSignRequest('eth_sendTransaction', [{ to: ME, data: '0xa9059cbb' + '00'.repeat(64) }]);
  assert.match(call?.rows[0]?.value ?? '', /^0xa9059cbb \(68 bytes/);
  assert.equal(describeSignRequest('eth_sendTransaction', [{ to: ME, value: '0x1' }]), null);
});
