import assert from 'node:assert/strict';
import test from 'node:test';

import { Interface, parseEther } from 'ethers';

import { classifyNftSpam, displayCollectionName } from './nft-spam';
import { analyzeProtectedRequest, assertProtectedClearance, type GuardInput } from './protected-guard';
import { buildApprovalProbes } from './protected-approvals';
import { protectedAssetFor, protectedBadgeLabel, yugaLookalikeMatch } from './yuga-allowlist';

// Yaper collections, checked Nov 3, 2026: OpenSea verified lil-apes / lil-mutants ("By Yaper"); owner() = yaper.eth on every contract.
const LIL_APES = '0xAa84ae8e0534cF682855222FD9186B2bcD9A650F';
const LBAC = '0x918F677b3aB4B9290Ca96A95430FD228b2d84817';
const LIL_MUTANTS = '0x3B45542f6C97FE7f7aA3BB055c95e93B2c0437ED';
const OWNER = '0x1111111111111111111111111111111111111111';
const FRIEND = '0x2222222222222222222222222222222222222222';
const FAKE = '0x3333333333333333333333333333333333333333';
const IFACE = new Interface([
  'function setApprovalForAll(address operator, bool approved)',
  'function transferFrom(address from, address to, uint256 tokenId)',
]);

function guard(method: string, params: unknown[]): GuardInput {
  return { method, params, chainId: 1, owner: OWNER, approvalsAllowed: () => false, floorWei: () => parseEther('1') };
}

test('Lil Apes and Lil Mutants are protected NFTs labeled by their own names with a "Protected" badge', () => {
  for (const [address, name] of [[LIL_APES, 'Lil Apes'], [LBAC, 'Lil Apes (original LBAC contract)'], [LIL_MUTANTS, 'Lil Mutants']]) {
    const asset = protectedAssetFor(1, address.toLowerCase());
    assert.ok(asset, name);
    assert.equal(asset.name, name);
    assert.equal(asset.standard, 'ERC-721');
    assert.equal(asset.brand, 'yaper');
    assert.equal(protectedBadgeLabel(asset), 'Protected');
    assert.doesNotMatch(asset.name, /yuga/i);
  }
  assert.equal(protectedBadgeLabel(protectedAssetFor(1, '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')), 'Verified');
  const risk = classifyNftSpam({ chainId: 1, contract: LIL_MUTANTS, tokenId: '7', standard: 'ERC-721', name: 'whatever', collection: 'x' }, new Set());
  assert.equal(risk.verified, true);
  assert.equal(risk.hidden, false);
  assert.equal(risk.label, 'Protected');
  assert.equal(displayCollectionName({ chainId: 1, contract: LIL_MUTANTS, collection: 'x' }), 'Lil Mutants');
});

test('Lil Apes / Lil Mutants lookalikes on other contracts are hidden and labeled fake', () => {
  for (const name of ['Lil Apes', 'LIL APES OFFICIAL', 'L1l Mutants', 'Lil Baby Ape Club', 'lil-mutant airdrop']) {
    assert.ok(yugaLookalikeMatch(name), name);
    const risk = classifyNftSpam({ chainId: 1, contract: FAKE, tokenId: '1', standard: 'ERC-721', name, collection: name, imageUrl: 'https://example.com/a.png' }, new Set([`1:${FAKE.toLowerCase()}:1`]));
    assert.equal(risk.fake, true, name);
    assert.equal(risk.hidden, true, name);
  }
  assert.equal(yugaLookalikeMatch('Pudgy Penguins'), null);
});

test('setApprovalForAll on Lil Apes / Lil Mutants is hard-blocked like Yuga; transfers need typed name + re-auth', () => {
  for (const [to, key] of [[LIL_APES, 'lil-apes'], [LBAC, 'lil-apes-lbac'], [LIL_MUTANTS, 'lil-mutants']]) {
    const approve = analyzeProtectedRequest(guard('eth_sendTransaction', [{ from: OWNER, to, data: IFACE.encodeFunctionData('setApprovalForAll', [FRIEND, true]) }]));
    assert.equal(approve.blocked, true, key);
    assert.equal(approve.findings[0]?.asset.key, key);
    const send = analyzeProtectedRequest(guard('eth_sendTransaction', [{ from: OWNER, to, data: IFACE.encodeFunctionData('transferFrom', [OWNER, FRIEND, 5n]) }]));
    assert.equal(send.protected, true, key);
    assert.equal(send.blocked, false, key);
    assert.throws(() => assertProtectedClearance(send, null));
    assert.doesNotThrow(() => assertProtectedClearance(send, send.fingerprint));
  }
});

test('protected approval scan covers the Yaper collections', () => {
  const keys = new Set(buildApprovalProbes(OWNER, 1, new Map()).map((probe) => probe.asset.key));
  for (const key of ['lil-apes', 'lil-apes-lbac', 'lil-mutants']) assert.ok(keys.has(key), key);
});
