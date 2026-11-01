import assert from 'node:assert/strict';
import test from 'node:test';
import { getAddress, Interface } from 'ethers';

import { DRAIN_APPROVAL_WARNING, decodeApprovalCalldata, inspectDappApproval } from './approval-risk';

const iface = new Interface([
  'function setApprovalForAll(address operator, bool approved)',
  'function approve(address spender, uint256 amount)',
  'function increaseAllowance(address spender, uint256 addedValue)',
]);

const TOKEN = getAddress('0x00000000000000000000000000000000000000aa');
const OPERATOR = getAddress('0x00000000000000000000000000000000000000bb');

test('flags setApprovalForAll as a drain-danger approval', () => {
  const data = iface.encodeFunctionData('setApprovalForAll', [OPERATOR, true]);
  const risk = decodeApprovalCalldata(TOKEN, data);
  assert.ok(risk);
  assert.equal(risk.kind, 'setApprovalForAll');
  assert.equal(risk.danger, true);
  assert.equal(risk.operator, OPERATOR);
  assert.ok(risk.warnings.includes(DRAIN_APPROVAL_WARNING));
  assert.equal(
    DRAIN_APPROVAL_WARNING,
    'This site is asking to take ALL NFTs in this collection. Scammers use this.',
  );
});

test('flags unlimited ERC-20 approve and increaseAllowance', () => {
  const max = (2n ** 256n - 1n).toString();
  const approve = decodeApprovalCalldata(
    TOKEN,
    iface.encodeFunctionData('approve', [OPERATOR, max]),
  );
  assert.equal(approve?.unlimited, true);
  assert.equal(approve?.danger, true);
  assert.ok(approve?.warnings.includes(DRAIN_APPROVAL_WARNING));
  const bump = decodeApprovalCalldata(
    TOKEN,
    iface.encodeFunctionData('increaseAllowance', [OPERATOR, max]),
  );
  assert.equal(bump?.kind, 'increaseAllowance');
  assert.equal(bump?.danger, true);
});

test('inspects WalletConnect send and typed permit payloads', () => {
  const data = iface.encodeFunctionData('setApprovalForAll', [OPERATOR, true]);
  const send = inspectDappApproval('eth_sendTransaction', [{ to: TOKEN, data }]);
  assert.equal(send?.kind, 'setApprovalForAll');
  const typed = inspectDappApproval('eth_signTypedData_v4', [
    '0xabc',
    JSON.stringify({
      primaryType: 'Permit',
      domain: { verifyingContract: TOKEN },
      message: { spender: OPERATOR, value: (2n ** 256n - 1n).toString() },
    }),
  ]);
  assert.equal(typed?.kind, 'permit');
  assert.equal(typed?.danger, true);
});
