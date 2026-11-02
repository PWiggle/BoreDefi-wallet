import assert from 'node:assert/strict';
import test from 'node:test';

import { Interface, MaxUint256, parseEther, ZeroAddress } from 'ethers';

import {
  analyzeProtectedRequest,
  assertProtectedClearance,
  BLIND_CONFIRM_PHRASE,
  confirmPhraseMatches,
  PERMIT2_ADDRESS,
  type GuardInput,
} from './protected-guard';

const OWNER = '0x1111111111111111111111111111111111111111';
const SCAMMER = '0x2222222222222222222222222222222222222222';
const BAYC = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
const MAYC = '0x60E4d786628Fea6478F785A6d7e704777c86a7c6';
const BACC = '0x22c36BfdCef207F9c0CC941936eff94D4246d14A';
const PUNKS = '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB';
const APE = '0x4d224452801ACEd8B2F0aebE155379bb5D594381';
const RANDOM_NFT = '0x3333333333333333333333333333333333333333';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const IFACE = new Interface([
  'function setApprovalForAll(address operator, bool approved)',
  'function approve(address spender, uint256 amountOrId)',
  'function transferFrom(address from, address to, uint256 id)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
  'function transfer(address to, uint256 amount)',
  'function offerPunkForSale(uint256 punkIndex, uint256 minSalePriceInWei)',
  'function multicall(bytes[] data)',
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function mint(uint256 amount)',
]);

const FLOOR = parseEther('10');

function input(method: string, params: unknown[], extra: Partial<GuardInput> = {}): GuardInput {
  return {
    method,
    params,
    chainId: 1,
    owner: OWNER,
    approvalsAllowed: () => false,
    floorWei: () => FLOOR,
    ...extra,
  };
}

function tx(to: string, data: string) {
  return input('eth_sendTransaction', [{ from: OWNER, to, data }]);
}

test('setApprovalForAll(true) on BAYC: decoded, red warning names collection + spender, blocked by default', () => {
  const data = IFACE.encodeFunctionData('setApprovalForAll', [SCAMMER, true]);
  const verdict = analyzeProtectedRequest(tx(BAYC, data));
  assert.equal(verdict.protected, true);
  assert.equal(verdict.findings[0]?.action, 'approval-all');
  assert.equal(verdict.findings[0]?.counterparty, SCAMMER);
  assert.match(verdict.headline, /Bored Ape Yacht Club/);
  assert.match(verdict.headline, /take ALL your apes/);
  assert.match(verdict.headline, new RegExp(SCAMMER));
  assert.equal(verdict.blocked, true);
  assert.match(verdict.blockReasons[0] ?? '', /Protected collections/);
  assert.equal(verdict.confirmPhrase, 'Bored Ape Yacht Club');
});

test('approval allowed in Settings window: not blocked, still needs typed confirm + clearance', () => {
  const data = IFACE.encodeFunctionData('setApprovalForAll', [SCAMMER, true]);
  const verdict = analyzeProtectedRequest({ ...tx(BAYC, data), approvalsAllowed: (key) => key === 'bayc' });
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.protected, true);
  assert.throws(() => assertProtectedClearance(verdict, null), /protected/);
  assert.throws(() => assertProtectedClearance(verdict, '0xdead'), /protected/);
  assert.doesNotThrow(() => assertProtectedClearance(verdict, verdict.fingerprint));
});

test('setApprovalForAll on ERC-1155 BACC and approve on ERC-721 MAYC are caught', () => {
  const all = analyzeProtectedRequest(tx(BACC, IFACE.encodeFunctionData('setApprovalForAll', [SCAMMER, true])));
  assert.equal(all.findings[0]?.asset.key, 'bacc');
  assert.equal(all.blocked, true);
  const one = analyzeProtectedRequest(tx(MAYC, IFACE.encodeFunctionData('approve(address,uint256)', [SCAMMER, 1234n])));
  assert.equal(one.findings[0]?.action, 'approve');
  assert.deepEqual(one.findings[0]?.tokenIds, ['1234']);
  assert.equal(one.blocked, true);
});

test('ApeCoin unlimited approve is blocked; approve(0) is a revoke and passes', () => {
  const bad = analyzeProtectedRequest(tx(APE, IFACE.encodeFunctionData('approve(address,uint256)', [SCAMMER, MaxUint256])));
  assert.equal(bad.blocked, true);
  assert.match(bad.headline, /ApeCoin/);
  const revoke = analyzeProtectedRequest(tx(APE, IFACE.encodeFunctionData('approve(address,uint256)', [SCAMMER, 0n])));
  assert.equal(revoke.protected, false);
  assert.equal(revoke.blocked, false);
  const revokeAll = analyzeProtectedRequest(tx(BAYC, IFACE.encodeFunctionData('setApprovalForAll', [SCAMMER, false])));
  assert.equal(revokeAll.protected, false);
});

test('transferFrom / 1155 safeTransferFrom / safeBatchTransferFrom need the warning but are not hard-blocked', () => {
  const t721 = analyzeProtectedRequest(tx(BAYC, IFACE.encodeFunctionData('transferFrom', [OWNER, SCAMMER, 7n])));
  assert.equal(t721.protected, true);
  assert.equal(t721.blocked, false);
  assert.equal(t721.findings[0]?.action, 'transfer');
  const t1155 = analyzeProtectedRequest(tx(BACC, IFACE.encodeFunctionData('safeTransferFrom(address,address,uint256,uint256,bytes)', [OWNER, SCAMMER, 1n, 1n, '0x'])));
  assert.equal(t1155.findings[0]?.action, 'transfer');
  const batch = analyzeProtectedRequest(tx(BACC, IFACE.encodeFunctionData('safeBatchTransferFrom', [OWNER, SCAMMER, [0n, 1n], [1n, 1n], '0x'])));
  assert.deepEqual(batch.findings[0]?.tokenIds, ['0', '1']);
  const ape = analyzeProtectedRequest(tx(APE, IFACE.encodeFunctionData('transfer', [SCAMMER, parseEther('5')])));
  assert.equal(ape.protected, true);
});

test('unrelated contracts are untouched; unknown calls into protected contracts are flagged', () => {
  const other = analyzeProtectedRequest(tx(RANDOM_NFT, IFACE.encodeFunctionData('setApprovalForAll', [SCAMMER, true])));
  assert.equal(other.protected, false);
  const unknown = analyzeProtectedRequest(tx(BAYC, IFACE.encodeFunctionData('mint', [1n])));
  assert.equal(unknown.findings[0]?.action, 'unknown-call');
  assert.equal(unknown.protected, true);
});

test('multicall and Multicall3 aggregate3 hide nothing', () => {
  const inner = IFACE.encodeFunctionData('setApprovalForAll', [SCAMMER, true]);
  const viaAggregate = IFACE.encodeFunctionData('aggregate3', [[{ target: MAYC, allowFailure: false, callData: inner }]]);
  const v1 = analyzeProtectedRequest(tx('0xcA11bde05977b3631167028862bE2a173976CA11', viaAggregate));
  assert.equal(v1.findings[0]?.asset.key, 'mayc');
  assert.equal(v1.blocked, true);
  const viaMulticall = IFACE.encodeFunctionData('multicall', [[inner]]);
  const v2 = analyzeProtectedRequest(tx(BAYC, viaMulticall));
  assert.equal(v2.findings[0]?.action, 'approval-all');
});

test('Permit2 approve() calldata for ApeCoin is blocked', () => {
  const data = IFACE.encodeFunctionData('approve(address,address,uint160,uint48)', [APE, SCAMMER, 2n ** 160n - 1n, 2n ** 48n - 1n]);
  const verdict = analyzeProtectedRequest(tx(PERMIT2_ADDRESS, data));
  assert.equal(verdict.findings[0]?.action, 'permit2');
  assert.equal(verdict.blocked, true);
});

test('CryptoPunks offerPunkForSale for 0 or under half floor is hard-blocked', () => {
  const zero = analyzeProtectedRequest(tx(PUNKS, IFACE.encodeFunctionData('offerPunkForSale', [1n, 0n])));
  assert.equal(zero.blocked, true);
  assert.match(zero.blockReasons.join(' '), /for 0/);
  const cheap = analyzeProtectedRequest(tx(PUNKS, IFACE.encodeFunctionData('offerPunkForSale', [1n, parseEther('4')])));
  assert.equal(cheap.blocked, true);
  const fair = analyzeProtectedRequest(tx(PUNKS, IFACE.encodeFunctionData('offerPunkForSale', [1n, parseEther('9')])));
  assert.equal(fair.blocked, false);
  assert.equal(fair.protected, true);
});

function seaportOrder(considerationToOwner: string, token = ZeroAddress, offerToken = BAYC, itemType = 2) {
  return JSON.stringify({
    domain: { name: 'Seaport', version: '1.6', chainId: 1, verifyingContract: '0x0000000000000068F116a894984e2DB1123eB395' },
    primaryType: 'OrderComponents',
    types: {},
    message: {
      offerer: OWNER,
      offer: [{ itemType, token: offerToken, identifierOrCriteria: '5', startAmount: '1', endAmount: '1' }],
      consideration: [
        { itemType: token === ZeroAddress ? 0 : 1, token, identifierOrCriteria: '0', startAmount: considerationToOwner, endAmount: considerationToOwner, recipient: OWNER },
        { itemType: 0, token: ZeroAddress, identifierOrCriteria: '0', startAmount: parseEther('100').toString(), endAmount: parseEther('100').toString(), recipient: SCAMMER },
      ],
    },
  });
}

test('Seaport listing of a BAYC for 0 / below half floor is hard-blocked; fair price passes with warning', () => {
  const zero = analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, seaportOrder('0')]));
  assert.equal(zero.blocked, true);
  const cheap = analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, seaportOrder(parseEther('1').toString())]));
  assert.equal(cheap.blocked, true);
  assert.match(cheap.blockReasons[0] ?? '', /under half of the floor/);
  const fair = analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, seaportOrder(parseEther('9.5').toString(), WETH)]));
  assert.equal(fair.blocked, false);
  assert.equal(fair.protected, true);
  assert.equal(fair.findings[0]?.action, 'listing');
  const unknownFloor = analyzeProtectedRequest({ ...input('eth_signTypedData_v4', [OWNER, seaportOrder(parseEther('9.5').toString())]), floorWei: () => null });
  assert.equal(unknownFloor.blocked, true);
  const oddCurrency = analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, seaportOrder(parseEther('9999').toString(), RANDOM_NFT)]));
  assert.equal(oddCurrency.blocked, true);
});

test('Seaport criteria listing (any token in the collection) and BulkOrder are covered', () => {
  const criteria = analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, seaportOrder('0', ZeroAddress, MAYC, 4)]));
  assert.equal(criteria.blocked, true);
  const order = JSON.parse(seaportOrder('0')).message;
  const bulk = JSON.stringify({ domain: { name: 'Seaport' }, primaryType: 'BulkOrder', types: {}, message: { tree: [[order, order]] } });
  const verdict = analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, bulk]));
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.findings.filter((item) => item.action === 'listing').length, 2);
});

test('Blur sell order below floor is blocked; Blur bulk Root is a blind signature', () => {
  const blur = JSON.stringify({
    domain: { name: 'Blur Exchange', version: '1.0', chainId: 1 },
    primaryType: 'Order',
    types: {},
    message: { trader: OWNER, side: 1, collection: BAYC, tokenId: '9', amount: '1', paymentToken: ZeroAddress, price: parseEther('0.5').toString(), fees: [] },
  });
  const verdict = analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, blur]));
  assert.equal(verdict.blocked, true);
  const root = JSON.stringify({ domain: { name: 'Blur Exchange' }, primaryType: 'Root', types: {}, message: { root: '0x' + '1'.repeat(64) } });
  const blind = analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, root]));
  assert.equal(blind.blind, true);
  assert.equal(blind.protected, true);
  assert.equal(blind.confirmPhrase, BLIND_CONFIRM_PHRASE);
});

test('Permit2 PermitSingle and ERC-2612 permit on ApeCoin are blocked by default', () => {
  const permit2 = JSON.stringify({
    domain: { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2_ADDRESS },
    primaryType: 'PermitSingle',
    types: {},
    message: { details: { token: APE, amount: MaxUint256.toString(), expiration: '0', nonce: '0' }, spender: SCAMMER, sigDeadline: '0' },
  });
  const v1 = analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, permit2]));
  assert.equal(v1.findings[0]?.action, 'permit2');
  assert.equal(v1.blocked, true);
  const erc2612 = JSON.stringify({
    domain: { name: 'ApeCoin', chainId: 1, verifyingContract: APE },
    primaryType: 'Permit',
    types: {},
    message: { owner: OWNER, spender: SCAMMER, value: '1', nonce: '0', deadline: '0' },
  });
  const v2 = analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, erc2612]));
  assert.equal(v2.findings[0]?.action, 'permit');
  assert.equal(v2.blocked, true);
});

test('eth_sign and hash-like personal_sign are blind; readable personal_sign is not', () => {
  const ethSign = analyzeProtectedRequest(input('eth_sign', [OWNER, '0x' + 'ab'.repeat(32)]));
  assert.equal(ethSign.blind, true);
  assert.equal(ethSign.protected, true);
  assert.equal(ethSign.blocked, false);
  const hash = analyzeProtectedRequest(input('personal_sign', ['0x' + 'cd'.repeat(32), OWNER]));
  assert.equal(hash.blind, true);
  const hello = analyzeProtectedRequest(input('personal_sign', ['0x' + Buffer.from('Sign in to OpenSea').toString('hex'), OWNER]));
  assert.equal(hello.protected, false);
});

test('unknown typed data that mentions a protected contract is treated as blind', () => {
  const odd = JSON.stringify({ domain: { name: 'Mystery' }, primaryType: 'Thing', types: {}, message: { target: BAYC.toLowerCase() } });
  const verdict = analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, odd]));
  assert.equal(verdict.blind, true);
  assert.equal(verdict.findings[0]?.asset.key, 'bayc');
  const harmless = JSON.stringify({ domain: { name: 'Login' }, primaryType: 'Login', types: {}, message: { nonce: '1' } });
  assert.equal(analyzeProtectedRequest(input('eth_signTypedData_v4', [OWNER, harmless])).protected, false);
});

test('typed confirm phrase is case and spacing insensitive', () => {
  assert.equal(confirmPhraseMatches('bored ape  yacht club', 'Bored Ape Yacht Club'), true);
  assert.equal(confirmPhraseMatches('bored ape', 'Bored Ape Yacht Club'), false);
  assert.equal(confirmPhraseMatches('', 'Bored Ape Yacht Club'), false);
});

test('fingerprint changes when any parameter changes (clearance cannot be reused)', () => {
  const a = analyzeProtectedRequest({ ...tx(BAYC, IFACE.encodeFunctionData('setApprovalForAll', [SCAMMER, true])), approvalsAllowed: () => true });
  const b = analyzeProtectedRequest({ ...tx(BAYC, IFACE.encodeFunctionData('setApprovalForAll', [OWNER, true])), approvalsAllowed: () => true });
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.throws(() => assertProtectedClearance(b, a.fingerprint));
});

test('Seaport validate() calldata (on-chain listing) for 0 is blocked', () => {
  const ORDER = '(address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems)';
  const iface = new Interface([`function validate((${ORDER} parameters, bytes signature)[] orders)`]);
  const zero32 = '0x' + '0'.repeat(64);
  const data = iface.encodeFunctionData('validate', [[{
    parameters: {
      offerer: OWNER, zone: ZeroAddress,
      offer: [{ itemType: 2, token: BAYC, identifierOrCriteria: 1n, startAmount: 1n, endAmount: 1n }],
      consideration: [{ itemType: 0, token: ZeroAddress, identifierOrCriteria: 0n, startAmount: 1n, endAmount: 1n, recipient: SCAMMER }],
      orderType: 0, startTime: 0n, endTime: 1n, zoneHash: zero32, salt: 0n, conduitKey: zero32, totalOriginalConsiderationItems: 1n,
    },
    signature: '0x',
  }]]);
  const verdict = analyzeProtectedRequest(tx('0x0000000000000068F116a894984e2DB1123eB395', data));
  assert.equal(verdict.findings[0]?.action, 'listing');
  assert.equal(verdict.blocked, true);
});
