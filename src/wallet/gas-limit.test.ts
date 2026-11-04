import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bufferGasLimit,
  isRevertOrFundsError,
  MIN_GAS_HEADROOM,
  resolveGasLimit,
  sendContractMethod,
  sendWithBufferedGas,
} from './gas-limit';
import { GAS_UNITS } from './preflight';
import { approveAndConfirm, sendAaveSupply } from './stake';

// The 1.0.4 failure: Aave V3 USDC supply, Ethereum tx 0x35b48b7d…a802.
const FAILED_LIMIT = 181_989n;
const FAILED_GAS_USED = 176_163n;
const ESTIMATE_NOW = 182_000n;

test('bufferGasLimit adds 30% (rounded up) on large estimates', () => {
  assert.equal(bufferGasLimit(ESTIMATE_NOW), 236_600n);
  assert.equal(bufferGasLimit(1_000_001n), 1_300_002n);
});

test('bufferGasLimit adds at least MIN_GAS_HEADROOM on small estimates', () => {
  assert.equal(bufferGasLimit(46_000n), 46_000n + MIN_GAS_HEADROOM);
  assert.equal(bufferGasLimit(60_000n), 85_000n);
});

test('bufferGasLimit keeps a plain 21,000 transfer exact (send max stays exact)', () => {
  assert.equal(bufferGasLimit(21_000n), 21_000n);
});

test('the buffered limit for the failed Aave supply clears the old limit and the gas it burned', () => {
  const limit = bufferGasLimit(FAILED_LIMIT);
  assert.ok(limit > FAILED_LIMIT + 50_000n);
  assert.ok(limit > FAILED_GAS_USED * 13n / 10n - 1n);
  assert.ok(limit <= GAS_UNITS.aaveSupply, 'preflight GAS_UNITS still covers the buffered limit');
});

test('resolveGasLimit: buffered estimate wins over a smaller provided limit', async () => {
  assert.equal(await resolveGasLimit(async () => 200_000n, { fallback: 1n, provided: 210_000n }), 260_000n);
});

test('resolveGasLimit: a larger provided (LI.FI / dApp) limit is kept', async () => {
  assert.equal(await resolveGasLimit(async () => 200_000n, { fallback: 1n, provided: 900_000n }), 900_000n);
});

test('resolveGasLimit: RPC failure falls back to GAS_UNITS', async () => {
  const limit = await resolveGasLimit(
    async () => {
      throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
    },
    { fallback: GAS_UNITS.aaveSupply },
  );
  assert.equal(limit, GAS_UNITS.aaveSupply);
});

test('resolveGasLimit: RPC failure with a provided limit keeps the provided limit', async () => {
  const limit = await resolveGasLimit(
    async () => {
      throw new Error('network down');
    },
    { fallback: 1n, provided: 333_000n },
  );
  assert.equal(limit, 333_000n);
});

test('resolveGasLimit: a revert is rethrown so a doomed tx is never sent', async () => {
  const revert = Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' });
  await assert.rejects(resolveGasLimit(async () => Promise.reject(revert), { fallback: 1n }), /execution reverted/);
  assert.equal(isRevertOrFundsError(revert), true);
  assert.equal(isRevertOrFundsError(Object.assign(new Error('x'), { code: 'INSUFFICIENT_FUNDS' })), true);
  assert.equal(isRevertOrFundsError(new Error('fetch failed')), false);
});

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type Call = { method: string; args: unknown[]; overrides: Record<string, unknown> };

function fakeContract(estimates: Record<string, bigint>, calls: Call[], order: string[], receiptStatus = 1) {
  return {
    getFunction(method: string) {
      const fn = async (...all: unknown[]) => {
        const overrides = all[all.length - 1] as Record<string, unknown>;
        calls.push({ method, args: all.slice(0, -1), overrides });
        order.push(`send:${method}`);
        return {
          hash: `0x${method}`,
          wait: async () => {
            order.push(`mined:${method}`);
            return { status: receiptStatus };
          },
        };
      };
      fn.estimateGas = async (..._all: unknown[]) => {
        order.push(`estimate:${method}`);
        return estimates[method] ?? 50_000n;
      };
      return fn;
    },
  } as never;
}

test('sendContractMethod passes a buffered gasLimit and forwards value', async () => {
  const calls: Call[] = [];
  const order: string[] = [];
  await sendContractMethod(fakeContract({ submit: 90_000n }, calls, order), 'submit', ['0x0'], {
    fallback: GAS_UNITS.lidoStake,
    value: 5n,
  });
  assert.deepEqual(calls[0]!.overrides, { value: 5n, gasLimit: 117_000n });
});

test('Aave supply: approve is mined before supply is estimated, and both get buffered gas', async () => {
  const calls: Call[] = [];
  const order: string[] = [];
  const token = fakeContract({ approve: 46_000n }, calls, order);
  const pool = fakeContract({ supply: ESTIMATE_NOW }, calls, order);
  await sendAaveSupply({
    token,
    pool,
    poolAddress: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    owner: '0x640ebc069e89e5691aad192420d22a4b92443387',
    amount: 1_000_000n,
    needsApproval: true,
    chainId: 1,
  });
  assert.deepEqual(order, ['estimate:approve', 'send:approve', 'mined:approve', 'estimate:supply', 'send:supply']);
  assert.equal(calls[0]!.overrides.gasLimit, 71_000n);
  assert.equal(calls[1]!.method, 'supply');
  assert.equal(calls[1]!.overrides.gasLimit, 236_600n);
  assert.ok((calls[1]!.overrides.gasLimit as bigint) > FAILED_LIMIT);
});

test('Aave supply without approval goes straight to a buffered supply', async () => {
  const calls: Call[] = [];
  const order: string[] = [];
  await sendAaveSupply({
    token: fakeContract({}, calls, order),
    pool: fakeContract({ supply: ESTIMATE_NOW }, calls, order),
    poolAddress: '0x1',
    asset: '0x2',
    owner: '0x3',
    amount: 1n,
    needsApproval: false,
    chainId: 1,
  });
  assert.deepEqual(order, ['estimate:supply', 'send:supply']);
  assert.equal(calls[0]!.overrides.gasLimit, 236_600n);
});

test('a reverted approval stops the flow before supply', async () => {
  const calls: Call[] = [];
  const order: string[] = [];
  await assert.rejects(approveAndConfirm(fakeContract({}, calls, order, 0), '0x1', 1n), /approval failed/);
  assert.ok(!order.some((step) => step.includes('supply')));
});

test('sendWithBufferedGas estimates without the provided limit, then sends the larger of the two', async () => {
  const seen: unknown[] = [];
  const signer = {
    estimateGas: async (tx: Record<string, unknown>) => {
      seen.push(tx);
      return 300_000n;
    },
    sendTransaction: async (tx: Record<string, unknown>) => {
      seen.push(tx);
      return { hash: '0x1' } as never;
    },
  };
  await sendWithBufferedGas(signer as never, { to: '0x1', data: '0xab', gasLimit: 310_000n }, GAS_UNITS.swap);
  assert.equal((seen[0] as { gasLimit?: bigint }).gasLimit, undefined);
  assert.equal((seen[1] as { gasLimit: bigint }).gasLimit, 390_000n);
});
