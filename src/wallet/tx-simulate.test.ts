import assert from 'node:assert/strict';
import test from 'node:test';

import { Interface, MaxUint256, parseEther } from 'ethers';

import { analyzeProtectedRequest, assertProtectedClearance, type GuardInput } from './protected-guard';
import {
  applySimulationToVerdict,
  buildTxPreview,
  cleanRevert,
  effectsFromLogs,
  mergeEffects,
  NATIVE_LOG_ADDRESS,
  parseSimulateV1,
  simCallFromTx,
  simulateCalls,
  simulationEffects,
  TOPIC_APPROVAL,
  TOPIC_APPROVAL_FOR_ALL,
  TOPIC_TRANSFER,
  TOPIC_TRANSFER_SINGLE,
  type SimLog,
  type Simulation,
} from './tx-simulate';

const OWNER = '0x1111111111111111111111111111111111111111';
const SCAMMER = '0x2222222222222222222222222222222222222222';
const FRIEND = '0x4444444444444444444444444444444444444444';
const ROUTER = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
const BAYC = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
const APE = '0x4d224452801ACEd8B2F0aebE155379bb5D594381';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const RANDOM_NFT = '0x3333333333333333333333333333333333333333';
const DRAINER = '0x5555555555555555555555555555555555555555';

const IFACE = new Interface([
  'function setApprovalForAll(address operator, bool approved)',
  'function transferFrom(address from, address to, uint256 id)',
  'function claim()',
]);

const topic = (address: string) => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
const uint = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;

const erc20Transfer = (token: string, from: string, to: string, amount: bigint): SimLog => ({ address: token, topics: [TOPIC_TRANSFER, topic(from), topic(to)], data: uint(amount) });
const nativeTransfer = (from: string, to: string, amount: bigint): SimLog => erc20Transfer(NATIVE_LOG_ADDRESS, from, to, amount);
const nftTransfer = (token: string, from: string, to: string, id: bigint): SimLog => ({ address: token, topics: [TOPIC_TRANSFER, topic(from), topic(to), uint(id)], data: '0x' });
const approvalForAll = (token: string, owner: string, operator: string, on: boolean): SimLog => ({ address: token, topics: [TOPIC_APPROVAL_FOR_ALL, topic(owner), topic(operator)], data: uint(on ? 1n : 0n) });
const erc20Approval = (token: string, owner: string, spender: string, amount: bigint): SimLog => ({ address: token, topics: [TOPIC_APPROVAL, topic(owner), topic(spender)], data: uint(amount) });

const simulated = (logs: SimLog[], ok = true, gasUsed = 120_000n): Simulation => ({
  kind: 'simulated',
  calls: [{ ok, gasUsed, logs, error: ok ? null : 'Not enough output' }],
  at: 0,
});

function guard(method: string, params: unknown[], overrides: Partial<GuardInput> = {}) {
  return analyzeProtectedRequest({
    method,
    params,
    chainId: 1,
    owner: OWNER,
    approvalsAllowed: () => false,
    floorWei: () => parseEther('10'),
    ...overrides,
  });
}

const ctx = (allowed = false) => ({ chainId: 1, approvalsAllowed: () => allowed });

// ---------------------------------------------------------------------------------------------
// RPC parsing / fallbacks
// ---------------------------------------------------------------------------------------------

test('parseSimulateV1 reads status, gas and logs; cleans the revert reason', () => {
  const calls = parseSimulateV1([
    {
      calls: [
        { status: '0x1', gasUsed: '0x5208', logs: [{ address: NATIVE_LOG_ADDRESS, topics: [TOPIC_TRANSFER], data: '0x' }] },
        { status: '0x0', gasUsed: '0x100', logs: [], error: { message: 'execution reverted: Too little received' } },
      ],
    },
  ]);
  assert.equal(calls[0]!.ok, true);
  assert.equal(calls[0]!.gasUsed, 21_000n);
  assert.equal(calls[0]!.logs.length, 1);
  assert.equal(calls[1]!.ok, false);
  assert.equal(calls[1]!.error, 'Too little received');
  assert.throws(() => parseSimulateV1({}));
  assert.equal(cleanRevert('execution reverted'), 'Execution reverted');
});

test('simulateCalls: eth_simulateV1 with traceTransfers, validation off; tries the next RPC', async () => {
  const seen: { method: string; params: unknown[] }[] = [];
  const broken = async () => {
    throw new Error('HTTP 429');
  };
  const good = async (method: string, params: unknown[]) => {
    seen.push({ method, params });
    return [{ calls: [{ status: '0x1', gasUsed: '0x5208', logs: [] }] }];
  };
  const result = await simulateCalls([broken, good], [{ from: OWNER, to: FRIEND, value: 5n }], () => 42);
  assert.equal(result.kind, 'simulated');
  assert.equal(seen[0]!.method, 'eth_simulateV1');
  const options = seen[0]!.params[0] as { traceTransfers: boolean; validation: boolean; blockStateCalls: { calls: Record<string, string>[] }[] };
  assert.equal(options.traceTransfers, true);
  assert.equal(options.validation, false);
  assert.deepEqual(options.blockStateCalls[0]!.calls[0], { from: OWNER, to: FRIEND, value: '0x5' });
  assert.equal(seen[0]!.params[1], 'latest');
});

test('simulateCalls: wallet cannot pay the value -> re-simulates with a temporary balance override and says so', async () => {
  const bodies: unknown[] = [];
  const node = async (_method: string, params: unknown[]) => {
    bodies.push(params[0]);
    const block = (params[0] as { blockStateCalls: { stateOverrides?: Record<string, { balance: string }> }[] }).blockStateCalls[0]!;
    if (!block.stateOverrides) {
      throw new Error('insufficient funds for gas * price + value: have 0 want 10000000000000000');
    }
    return [{ calls: [{ status: '0x1', gasUsed: '0x5208', logs: [nativeTransfer(OWNER, ROUTER, 10n ** 16n)] }] }];
  };
  const result = await simulateCalls([node], [{ from: OWNER, to: ROUTER, value: 10n ** 16n }]);
  assert.equal(result.kind === 'simulated' && result.fundedOverride, true);
  const override = (bodies[1] as { blockStateCalls: { stateOverrides: Record<string, { balance: string }> }[] }).blockStateCalls[0]!.stateOverrides;
  assert.equal(BigInt(override[OWNER]!.balance), 10n ** 16n + 1000n * 10n ** 18n);
  const preview = buildTxPreview({ method: 'eth_sendTransaction', params: [{}], chainId: 1, owner: OWNER, simulation: result });
  assert.match(preview.lines[preview.lines.length - 1]!.text, /does not hold enough ETH/);
  assert.equal(preview.lines[0]!.text, 'You send 0.01 ETH to LI.FI (0x1231…4EaE)');
});

test('simulateCalls falls back to eth_estimateGas, then reports unavailable', async () => {
  const noSimulate = async (method: string) => {
    if (method === 'eth_simulateV1') {
      throw new Error('Method not found');
    }
    return '0x7530';
  };
  const estimated = await simulateCalls([noSimulate], [{ from: OWNER, to: FRIEND }]);
  assert.deepEqual(estimated.kind === 'estimated' && [estimated.ok, estimated.gasUsed], [true, 30_000n]);

  const reverting = async (method: string) => {
    throw new Error(method === 'eth_simulateV1' ? 'Method not found' : 'execution reverted: nope');
  };
  const failed = await simulateCalls([reverting], [{ from: OWNER, to: FRIEND }]);
  assert.equal(failed.kind, 'estimated');
  assert.equal(failed.kind === 'estimated' && failed.ok, false);

  const down = async () => {
    throw new Error('fetch failed');
  };
  assert.equal((await simulateCalls([down], [{ from: OWNER }])).kind, 'unavailable');
});

test('simCallFromTx keeps from/to/value/data/gas from a dApp request', () => {
  const call = simCallFromTx(OWNER, { from: OWNER.toUpperCase().replace('0X', '0x'), to: USDC.toLowerCase(), value: '0x10', data: '0xabcd', gas: '0x5208' });
  assert.equal(call.to, USDC);
  assert.equal(call.value, 16n);
  assert.equal(call.data, '0xabcd');
  assert.equal(call.gas, 21_000n);
});

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

test('effectsFromLogs: what leaves, what arrives, who gets approval (only for this wallet)', () => {
  const effects = effectsFromLogs(
    [
      nativeTransfer(OWNER, ROUTER, parseEther('0.5')),
      erc20Transfer(USDC, ROUTER, OWNER, 1_000_000n),
      erc20Transfer(USDC, ROUTER, FRIEND, 5n), // someone else's transfer: ignored
      nftTransfer(BAYC, OWNER, SCAMMER, 1234n),
      approvalForAll(RANDOM_NFT, OWNER, SCAMMER, true),
      { address: RANDOM_NFT, topics: [TOPIC_TRANSFER_SINGLE, topic(SCAMMER), topic(OWNER), topic(FRIEND)], data: `${uint(7n)}${uint(2n).slice(2)}` },
    ],
    OWNER,
  );
  assert.deepEqual(
    effects.map((effect) => [effect.type, effect.standard, effect.type === 'approval' ? effect.spender : effect.counterparty]),
    [
      ['out', 'native', ROUTER],
      ['in', 'erc20', ROUTER],
      ['out', 'erc721', SCAMMER],
      ['approval', 'nft-all', SCAMMER],
      ['out', 'erc1155', FRIEND],
    ],
  );
  const nft = effects[2]!;
  assert.deepEqual(nft.type === 'out' && nft.tokenIds, ['1234']);
  const single = effects[4]!;
  assert.deepEqual(single.type === 'out' && [single.tokenIds, single.amount], [['7'], 2n]);
});

test('effectsFromLogs drops the ERC-20 Approval bookkeeping that transferFrom emits', () => {
  const effects = effectsFromLogs([erc20Approval(USDC, OWNER, ROUTER, 0n), erc20Transfer(USDC, OWNER, ROUTER, 10n)], OWNER);
  assert.deepEqual(effects.map((effect) => effect.type), ['out']);
  const grant = effectsFromLogs([erc20Approval(USDC, OWNER, ROUTER, MaxUint256)], OWNER);
  assert.equal(grant[0]!.type, 'approval');
});

test('mergeEffects sums the same token in the same direction', () => {
  const merged = mergeEffects(effectsFromLogs([erc20Transfer(USDC, ROUTER, OWNER, 1n), erc20Transfer(USDC, FRIEND, OWNER, 2n)], OWNER));
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.type === 'in' && merged[0]!.amount, 3n);
});

test('simulationEffects ignores failed calls', () => {
  assert.deepEqual(simulationEffects(simulated([nftTransfer(BAYC, OWNER, SCAMMER, 1n)], false), OWNER), []);
  assert.deepEqual(simulationEffects(null, OWNER), []);
});

// ---------------------------------------------------------------------------------------------
// Plain-words preview
// ---------------------------------------------------------------------------------------------

test('preview of a swap: what leaves and what arrives, in plain words', () => {
  const preview = buildTxPreview({
    method: 'eth_sendTransaction',
    params: [{ from: OWNER, to: ROUTER, value: '0x2386f26fc10000', data: '0x1234' }],
    chainId: 1,
    owner: OWNER,
    simulation: simulated([nativeTransfer(OWNER, ROUTER, parseEther('0.01')), erc20Transfer(USDC, ROUTER, OWNER, 22_770_692n)], true, 304_392n),
    labels: new Map([[USDC.toLowerCase(), { symbol: 'USDC', decimals: 6 }]]),
  });
  assert.equal(preview.status, 'simulated');
  assert.deepEqual(preview.lines, [
    { tone: 'out', text: 'You send 0.01 ETH to LI.FI (0x1231…4EaE)' },
    { tone: 'in', text: 'You receive 22.770692 USDC' },
  ]);
  assert.equal(preview.gasUsed, 304_392n);
  assert.match(preview.note, /Simulated on Ethereum/);
});

test('preview names a protected NFT and an approve-all in plain words', () => {
  const preview = buildTxPreview({
    method: 'eth_sendTransaction',
    params: [{}],
    chainId: 1,
    owner: OWNER,
    simulation: simulated([nftTransfer(BAYC, OWNER, SCAMMER, 42n), approvalForAll(BAYC, OWNER, SCAMMER, true)]),
  });
  assert.deepEqual(preview.lines.map((line) => line.text), [
    'You send Bored Ape Yacht Club #42 to 0x2222…2222',
    '0x2222…2222 gets permission to take ALL your Bored Ape Yacht Club',
  ]);
});

test('preview: a failing transaction and a no-op transaction', () => {
  const failing = buildTxPreview({ method: 'eth_sendTransaction', params: [{}], chainId: 1, owner: OWNER, simulation: simulated([], false) });
  assert.equal(failing.willFail, true);
  assert.match(failing.lines[0]!.text, /This would fail: Not enough output/);
  const noop = buildTxPreview({ method: 'eth_sendTransaction', params: [{}], chainId: 1, owner: OWNER, simulation: simulated([]) });
  assert.match(noop.lines[0]!.text, /No tokens or NFTs move/);
});

test('preview without a simulation still decodes the calldata and says it was not simulated', () => {
  const data = IFACE.encodeFunctionData('setApprovalForAll', [SCAMMER, true]);
  const preview = buildTxPreview({ method: 'eth_sendTransaction', params: [{ to: RANDOM_NFT, data }], chainId: 1, owner: OWNER, simulation: { kind: 'unavailable', error: 'down', at: 0 } });
  assert.equal(preview.status, 'unavailable');
  assert.equal(preview.lines[0]!.tone, 'danger');
  assert.match(preview.lines[1]!.text, /gets permission to take ALL/);
});

test('preview of signatures: text message, blind data and a permit', () => {
  const text = buildTxPreview({ method: 'personal_sign', params: ['0x68656c6c6f', OWNER], chainId: 1, owner: OWNER, simulation: null });
  assert.equal(text.status, 'signature');
  assert.match(text.lines[0]!.text, /Nothing leaves your wallet/);
  const blind = buildTxPreview({ method: 'personal_sign', params: ['0x00', OWNER], chainId: 1, owner: OWNER, simulation: null, blind: true });
  assert.equal(blind.lines[0]!.tone, 'danger');
  const permit = JSON.stringify({
    primaryType: 'Permit',
    domain: { name: 'USD Coin', verifyingContract: USDC },
    message: { owner: OWNER, spender: SCAMMER, value: MaxUint256.toString(), deadline: '1' },
  });
  const signed = buildTxPreview({ method: 'eth_signTypedData_v4', params: [OWNER, permit], chainId: 1, owner: OWNER, simulation: null });
  assert.equal(signed.lines[0]!.tone, 'approval');
  assert.match(signed.lines[0]!.text, /0x2222…2222 gets permission to spend unlimited/);
});

// ---------------------------------------------------------------------------------------------
// Protected assets: simulation findings join the guard
// ---------------------------------------------------------------------------------------------

test('BLOCK: hidden BAYC transfer (unknown contract call drains via an old approval)', () => {
  const params = [{ from: OWNER, to: DRAINER, data: IFACE.encodeFunctionData('claim') }];
  const before = guard('eth_sendTransaction', params);
  assert.equal(before.protected, false, 'calldata alone looks harmless');
  const after = applySimulationToVerdict(before, simulationEffects(simulated([nftTransfer(BAYC, OWNER, SCAMMER, 1n)]), OWNER), ctx());
  assert.equal(after.protected, true);
  assert.equal(after.blocked, true);
  assert.match(after.blockReasons[0]!, /Hidden transfer of your Bored Ape Yacht Club/);
  assert.match(after.headline, /hidden move/);
  assert.equal(after.fingerprint, before.fingerprint);
  assert.throws(() => assertProtectedClearance(after, after.fingerprint), /Hidden transfer/);
});

test('BLOCK: hidden ApeCoin outflow and hidden approve-all of a protected collection', () => {
  const params = [{ from: OWNER, to: DRAINER, data: IFACE.encodeFunctionData('claim') }];
  const apeOut = applySimulationToVerdict(guard('eth_sendTransaction', params), simulationEffects(simulated([erc20Transfer(APE, OWNER, SCAMMER, parseEther('500'))]), OWNER), ctx());
  assert.equal(apeOut.blocked, true);
  const approval = applySimulationToVerdict(guard('eth_sendTransaction', params), simulationEffects(simulated([approvalForAll(BAYC, OWNER, SCAMMER, true)]), OWNER), ctx());
  assert.equal(approval.blocked, true);
  assert.match(approval.blockReasons[0]!, /Hidden approval/);
});

test('hidden protected move with the 10-minute approvals window open: red confirm, not a hard block', () => {
  const params = [{ from: OWNER, to: DRAINER, data: IFACE.encodeFunctionData('claim') }];
  const after = applySimulationToVerdict(guard('eth_sendTransaction', params), simulationEffects(simulated([nftTransfer(BAYC, OWNER, SCAMMER, 1n)]), OWNER), ctx(true));
  assert.equal(after.protected, true);
  assert.equal(after.blocked, false);
  assert.equal(after.confirmPhrase, 'Bored Ape Yacht Club');
  assert.throws(() => assertProtectedClearance(after, null));
  assert.doesNotThrow(() => assertProtectedClearance(after, after.fingerprint));
});

test('BLOCK: a protected NFT going somewhere other than the address the request names', () => {
  const params = [{ from: OWNER, to: BAYC, data: IFACE.encodeFunctionData('transferFrom', [OWNER, FRIEND, 1n]) }];
  const before = guard('eth_sendTransaction', params);
  assert.equal(before.blocked, false);
  const after = applySimulationToVerdict(before, simulationEffects(simulated([nftTransfer(BAYC, OWNER, SCAMMER, 1n)]), OWNER), ctx(true));
  assert.equal(after.blocked, true);
  assert.match(after.blockReasons.join(' '), /not the address this request names/);
});

test('a protected transfer the request already shows is unchanged by a matching simulation', () => {
  const params = [{ from: OWNER, to: BAYC, data: IFACE.encodeFunctionData('transferFrom', [OWNER, FRIEND, 1n]) }];
  const before = guard('eth_sendTransaction', params);
  const after = applySimulationToVerdict(before, simulationEffects(simulated([nftTransfer(BAYC, OWNER, FRIEND, 1n)]), OWNER), ctx());
  assert.equal(after, before);
});

test('BAYC approve-all stays blocked (static guard) and the simulation adds no duplicate block', () => {
  const params = [{ from: OWNER, to: BAYC, data: IFACE.encodeFunctionData('setApprovalForAll', [SCAMMER, true]) }];
  const before = guard('eth_sendTransaction', params);
  assert.equal(before.blocked, true);
  const after = applySimulationToVerdict(before, simulationEffects(simulated([approvalForAll(BAYC, OWNER, SCAMMER, true)]), OWNER), ctx());
  assert.equal(after.blocked, true);
  assert.equal(after.blockReasons.length, before.blockReasons.length);
});

test('normal requests (non-protected tokens, incoming apes) are not blocked by the simulation', () => {
  const params = [{ from: OWNER, to: ROUTER, value: '0x1', data: '0x1234' }];
  const before = guard('eth_sendTransaction', params);
  const swap = applySimulationToVerdict(before, simulationEffects(simulated([nativeTransfer(OWNER, ROUTER, 1n), erc20Transfer(USDC, ROUTER, OWNER, 5n)]), OWNER), ctx());
  assert.equal(swap, before);
  assert.equal(swap.protected, false);
  const buyApe = applySimulationToVerdict(before, simulationEffects(simulated([nftTransfer(BAYC, SCAMMER, OWNER, 9n)]), OWNER), ctx());
  assert.equal(buyApe.blocked, false);
  assert.equal(buyApe.protected, false);
});

test('ApeChain: native APE leaving through a hidden path is protected', () => {
  const params = [{ from: OWNER, to: DRAINER, data: IFACE.encodeFunctionData('claim') }];
  const before = guard('eth_sendTransaction', params, { chainId: 33139 });
  assert.equal(before.protected, false);
  const after = applySimulationToVerdict(before, simulationEffects(simulated([nativeTransfer(OWNER, SCAMMER, parseEther('100'))]), OWNER), { chainId: 33139, approvalsAllowed: () => false });
  assert.equal(after.blocked, true);
  assert.match(after.blockReasons[0]!, /ApeCoin \(ApeChain\)/);
});
