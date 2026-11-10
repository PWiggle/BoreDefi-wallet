import assert from 'node:assert/strict';
import test from 'node:test';

import { Interface, MaxUint256 } from 'ethers';

import { decodeApprovalCalldata, inspectDappApproval, isPermit2, PERMIT2_ADDRESS } from './approval-risk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const IFACE = new Interface(['function setApprovalForAll(address,bool)', 'function approve(address,uint256)']);
const SPENDER = '0x1111111111111111111111111111111111111111';

test('setApprovalForAll on a protected collection gets the strongest warning', () => {
  const risk = decodeApprovalCalldata('0x3B45542f6C97FE7f7aA3BB055c95e93B2c0437ED', IFACE.encodeFunctionData('setApprovalForAll', [SPENDER, true]));
  assert.ok(risk?.danger);
  assert.match(risk!.summary, /PROTECTED COLLECTION/);
  assert.match(risk!.warnings[0], /protected collection/);
});

test('unlimited approve is flagged', () => {
  const risk = decodeApprovalCalldata('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', IFACE.encodeFunctionData('approve', [SPENDER, MaxUint256]));
  assert.equal(risk?.unlimited, true);
});

test('Permit2 typed data is recognized and warned', () => {
  assert.equal(isPermit2(PERMIT2_ADDRESS, null), true);
  const typed = {
    domain: { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2_ADDRESS },
    primaryType: 'PermitSingle',
    types: {},
    message: { details: { token: SPENDER, amount: '1461501637330902918203684832716283019655932542975' }, spender: SPENDER },
  };
  const risk = inspectDappApproval('eth_signTypedData_v4', [SPENDER, JSON.stringify(typed)]);
  assert.ok(risk?.danger);
  assert.match(risk!.summary, /Permit2/);
});

test('raw eth_sign is always refused before any key is used (browser + WalletConnect share wc-sign)', () => {
  const src = readFileSync(join(__dirname, 'wc-sign.ts'), 'utf8');
  assert.match(src, /case 'eth_sign':\s*\/\/[^\n]*\n\s*throw new Error\(ETH_SIGN_BLOCKED\);/);
  assert.ok(!/case 'eth_sign': \{[\s\S]{0,200}signMessage/.test(src));
});
