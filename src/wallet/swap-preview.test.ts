import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Interface } from 'ethers';

import type { SwapQuote } from './swap';
import { gasLimitDetail, swapFeeGasUnits, swapSimCalls, unexpectedProtectedMoves } from './swap-preview';
import { TOPIC_TRANSFER, type Simulation } from './tx-simulate';

const OWNER = '0x1111111111111111111111111111111111111111';
const ROUTER = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const APE = '0x4d224452801ACEd8B2F0aebE155379bb5D594381';
const BAYC = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';

const quote = (gasLimit?: bigint): SwapQuote => ({
  tool: 'x',
  toolName: 'X',
  fromToken: { address: USDC, decimals: 6, symbol: 'USDC' },
  toToken: { address: '0x0000000000000000000000000000000000000000', decimals: 18, symbol: 'ETH' },
  fromAmountUsd: null,
  toAmountUsd: null,
  fromAmount: 5_000_000n,
  toAmount: 1n,
  toAmountMin: 1n,
  approvalAddress: ROUTER,
  transactionRequest: { to: ROUTER, data: '0xabcdef', value: 0n, gasLimit },
});

const topic = (address: string) => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
const sim = (logs: { address: string; topics: string[]; data: string }[]): Simulation => ({ kind: 'simulated', calls: [{ ok: true, gasUsed: 1n, logs, error: null }], at: 0 });

test('swap preview simulates approve + swap together, approve only when needed', () => {
  const token = { address: USDC, native: false };
  const both = swapSimCalls(OWNER, token, quote(300_000n), true);
  assert.equal(both.length, 2);
  const approve = new Interface(['function approve(address,uint256)']).decodeFunctionData('approve', both[0]!.data!);
  assert.deepEqual([both[0]!.to, approve[0], approve[1]], [USDC, ROUTER, 5_000_000n]);
  assert.deepEqual([both[1]!.to, both[1]!.data, both[1]!.gas], [ROUTER, '0xabcdef', 300_000n]);
  assert.equal(swapSimCalls(OWNER, token, quote(), false).length, 1);
  assert.equal(swapSimCalls(OWNER, { address: '0x0000000000000000000000000000000000000000', native: true }, quote(), true).length, 1);
});

test('swap fee gas: simulated gas first, then the route gas limit (+ approve), then the default', () => {
  assert.equal(swapFeeGasUnits(quote(400_000n), 150_000n, true), 150_000n);
  assert.equal(swapFeeGasUnits(quote(400_000n), null, true), 470_000n);
  assert.equal(swapFeeGasUnits(null, null, false), 400_000n);
  assert.equal(gasLimitDetail(412_000n), 'Gas limit 412,000 (the most this swap can use; you pay only what it uses)');
  assert.equal(gasLimitDetail(undefined), undefined);
});

test('in-app actions block protected assets the user did not choose to spend', () => {
  const apeOut = sim([{ address: APE, topics: [TOPIC_TRANSFER, topic(OWNER), topic(ROUTER)], data: `0x${'1'.padStart(64, '0')}` }]);
  assert.deepEqual(unexpectedProtectedMoves(1, apeOut, OWNER, new Set()).map((item) => item.key), ['ape-eth']);
  assert.deepEqual(unexpectedProtectedMoves(1, apeOut, OWNER, new Set(['ape-eth'])), []);
  const apeIn = sim([{ address: BAYC, topics: [TOPIC_TRANSFER, topic(ROUTER), topic(OWNER), `0x${'1'.padStart(64, '0')}`], data: '0x' }]);
  assert.deepEqual(unexpectedProtectedMoves(1, apeIn, OWNER, new Set()), []);
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('LOCK: swap confirm shows the fee in ETH and $, not the raw gas limit', () => {
  const screen = read('../screens/SwapScreen.tsx');
  const sheet = read('../components/SwapConfirmSheet.tsx');
  assert.doesNotMatch(screen, /fee=\{[^}]*`Gas limit \$\{/);
  assert.match(screen, /<SwapConfirmSheet/);
  assert.match(screen, /formatNetworkFee/);
  assert.match(screen, /prepareSwapReview/);
  assert.match(sheet, /feeDetail=\{gasLimitDetail\(/);
});

test('LOCK: every dApp path simulates before signing; wc-sign re-checks with the simulation', () => {
  assert.match(read('../components/WalletConnectOverlay.tsx'), /reviewDappRequest\(/);
  assert.match(read('../screens/BrowserScreen.tsx'), /reviewDappRequest\(/);
  assert.match(read('./wc-sign.ts'), /evaluateProtectedRequest\(\{[^}]*simulation: 'auto'/);
  assert.match(read('../screens/SendScreen.tsx'), /previewInAppCalls\(/);
  assert.match(read('../screens/NftSendScreen.tsx'), /previewInAppCalls\(/);
});

test('LOCK: the proof screen is compiled out of store builds and never signs', () => {
  assert.match(read('../proof-mode.ts'), /process\.env\.EXPO_PUBLIC_PROOF_MODE === '1'/);
  const proof = read('../screens/ProofScreen.tsx');
  assert.doesNotMatch(proof, /mnemonic|handleWalletConnectRequest|sendSwapTransaction|sendTransaction\(/);
  assert.match(read('../../App.tsx'), /PROOF_MODE \? <MainStack\.Screen name="Proof"/);
});
