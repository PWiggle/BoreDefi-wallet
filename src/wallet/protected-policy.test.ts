import assert from 'node:assert/strict';
import test from 'node:test';

import { parseEther } from 'ethers';

import {
  candidatesFromLogs,
  buildApprovalProbes,
  decodeProbeBatch,
  encodeProbeBatch,
  revokeCalldata,
  blockscoutLogsUrl,
  TOPIC_APPROVAL_FOR_ALL,
  TOPIC_APPROVAL,
} from './protected-approvals';
import { parseFloorResponse } from './protected-floor';
import {
  addAddressBookEntry,
  APPROVAL_WINDOW_MS,
  approvalsAllowed,
  checkProtectedRecipient,
  DEFAULT_PROTECTED_POLICY,
  normalizePolicy,
  openApprovalWindow,
  pruneExpiredWindows,
  recipientTailMatches,
  rememberRecipient,
} from './protected-policy';
import { AbiCoder, Interface } from 'ethers';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

test('allow-approvals window turns itself off after 10 minutes', () => {
  const now = 1_000_000;
  const open = openApprovalWindow(DEFAULT_PROTECTED_POLICY, 'bayc', now);
  assert.equal(approvalsAllowed(open, 'bayc', now + 1000), true);
  assert.equal(approvalsAllowed(open, 'mayc', now + 1000), false);
  assert.equal(approvalsAllowed(open, 'bayc', now + APPROVAL_WINDOW_MS + 1), false);
  assert.deepEqual(pruneExpiredWindows(open, now + APPROVAL_WINDOW_MS + 1).approvalWindows, {});
  assert.equal(APPROVAL_WINDOW_MS, 600_000);
});

test('new-recipient warning and address-book-only lock', () => {
  let policy = DEFAULT_PROTECTED_POLICY;
  assert.equal(checkProtectedRecipient(policy, A).isNew, true);
  policy = rememberRecipient(policy, A);
  assert.equal(checkProtectedRecipient(policy, A).isNew, false);
  policy = { ...policy, addressBookOnly: true };
  assert.equal(checkProtectedRecipient(policy, A).allowed, false);
  policy = addAddressBookEntry(policy, B, 'Cold wallet');
  const ok = checkProtectedRecipient(policy, B.toLowerCase());
  assert.equal(ok.allowed, true);
  assert.equal(ok.label, 'Cold wallet');
  assert.equal(normalizePolicy(JSON.parse(JSON.stringify(policy))).addressBook[0]?.address, B);
});

test('check-twice: typed last 4 characters must match', () => {
  assert.equal(recipientTailMatches(B, '2222'), true);
  assert.equal(recipientTailMatches(B, '1111'), false);
});

test('floor parse keeps fresh ETH floors only and takes the higher', () => {
  const now = Date.parse('2026-11-02T00:00:00Z');
  const body = {
    openSea: { floorPrice: 5.8787, priceCurrency: 'ETH', retrievedAt: '2026-11-01T23:00:00Z', error: null },
    looksRare: { floorPrice: 69, priceCurrency: 'ETH', retrievedAt: '2025-01-13T03:42:07Z', error: null },
  };
  assert.equal(parseFloorResponse(body, now), parseEther('5.8787'));
  assert.equal(parseFloorResponse({ openSea: { error: 'x' } }, now), null);
});

test('approval scan: candidates from logs, multicall probes, decode, revoke calldata', () => {
  const pad = (address: string) => '0x' + address.slice(2).toLowerCase().padStart(64, '0');
  const logs = [
    { address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', topics: [TOPIC_APPROVAL_FOR_ALL, pad(A), pad(B)] },
    { address: '0x4d224452801aced8b2f0aebe155379bb5d594381', topics: [TOPIC_APPROVAL, pad(A), pad(B)] },
    { address: '0x3333333333333333333333333333333333333333', topics: [TOPIC_APPROVAL_FOR_ALL, pad(A), pad(B)] },
  ];
  const candidates = candidatesFromLogs(logs, 1);
  assert.deepEqual([...candidates.keys()].sort(), ['ape-eth', 'bayc']);
  const probes = buildApprovalProbes(A, 1, candidates);
  assert.ok(probes.some((probe) => probe.asset.key === 'bayc' && probe.spender === B));
  assert.ok(!probes.some((probe) => probe.asset.key === 'cryptopunks'));
  assert.ok(encodeProbeBatch(probes).startsWith('0x82ad56cb')); // aggregate3 selector
  const coder = AbiCoder.defaultAbiCoder();
  const rows = probes.map((probe) => {
    const live = probe.asset.key === 'bayc' && probe.spender === B;
    const liveApe = probe.asset.key === 'ape-eth' && probe.spender === B;
    if (probe.asset.standard === 'ERC-20') {
      return [true, coder.encode(['uint256'], [liveApe ? 5n : 0n])];
    }
    return [true, coder.encode(['bool'], [live])];
  });
  const result = new Interface(['function aggregate3((address,bool,bytes)[]) view returns ((bool success, bytes returnData)[])']).encodeFunctionResult('aggregate3', [rows]);
  const live = decodeProbeBatch(probes, result);
  assert.equal(live.length, 2);
  const nft = live.find((item) => item.kind === 'operator')!;
  assert.equal(nft.asset.key, 'bayc');
  assert.equal(revokeCalldata(nft), new Interface(['function setApprovalForAll(address,bool)']).encodeFunctionData('setApprovalForAll', [B, false]));
  const ape = live.find((item) => item.kind === 'allowance')!;
  assert.equal(revokeCalldata(ape), new Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [B, 0n]));
  assert.match(blockscoutLogsUrl('https://eth.blockscout.com/api/v2', A, TOPIC_APPROVAL_FOR_ALL), /^https:\/\/eth\.blockscout\.com\/api\?module=logs/);
});
