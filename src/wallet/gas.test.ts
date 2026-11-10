import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bucketBaseFees,
  chartPath,
  fetchGasHistory,
  fetchGasSnapshot,
  formatGwei,
  formatUsdFee,
  gasCostUsd,
  gasLevel,
  GAS_REFRESH_MS,
  medianNonZero,
  parseGasApi,
  parseGasHistory,
  tiersFromFeeHistory,
  TYPICAL_ACTIONS,
} from './gas';

const API = {
  chainId: 1,
  updatedAt: '2026-11-03T13:50:42.318Z',
  latestBlock: 26334684,
  baseFeeGwei: 0.384069297,
  low: { gwei: 0.38407023, tipGwei: 9.33e-7 },
  average: { gwei: 0.4414656555, tipGwei: 0.0573963585 },
  fast: { gwei: 2.384069297, tipGwei: 2 },
  gasPriceGwei: 0.357416853,
  ethUsd: 2290.57,
  apeChain: { gasPriceGwei: 101.68276, apeUsd: 0.111616 },
};

type Reply = { ok: boolean; status?: number; json: () => Promise<unknown> };
const reply = (body: unknown, ok = true): Reply => ({ ok, status: ok ? 200 : 503, json: async () => body });

test('parseGasApi reads the boredefi.com /api/gas payload', () => {
  const snap = parseGasApi(API);
  assert.equal(snap.source, 'boredefi');
  assert.equal(snap.average.gwei, 0.4414656555);
  assert.equal(snap.ethUsd, 2290.57);
  assert.deepEqual(snap.apeChain, { gasPriceGwei: 101.68276, apeUsd: 0.111616 });
  assert.equal(snap.updatedAt, Date.parse(API.updatedAt));
  assert.throws(() => parseGasApi({ ...API, average: null }));
  assert.throws(() => parseGasApi({ ...API, chainId: 5 }));
  assert.throws(() => parseGasApi('nope'));
});

test('tiersFromFeeHistory: next base fee + median p10/p50/p90 tip (zero tips ignored)', () => {
  const gwei = (value: number) => `0x${BigInt(Math.round(value * 1e9)).toString(16)}`;
  const tiers = tiersFromFeeHistory({
    baseFeePerGas: [gwei(1), gwei(2), gwei(3)],
    reward: [
      [gwei(0.1), gwei(0.5), gwei(2)],
      ['0x0', gwei(0.7), gwei(4)],
      [gwei(0.3), gwei(0.6), gwei(3)],
    ],
  });
  assert.equal(tiers.baseFeeGwei, 3);
  assert.ok(Math.abs(tiers.low.gwei - 3.2) < 1e-9);
  assert.ok(Math.abs(tiers.average.gwei - 3.6) < 1e-9);
  assert.ok(Math.abs(tiers.fast.gwei - 6) < 1e-9);
  assert.equal(medianNonZero([0, 0]), 0);
  assert.throws(() => tiersFromFeeHistory({ baseFeePerGas: [] }));
});

test('fetchGasSnapshot uses the boredefi.com API first', async () => {
  const urls: string[] = [];
  const snap = await fetchGasSnapshot(async (url) => {
    urls.push(url);
    return reply(API);
  });
  assert.equal(snap.source, 'boredefi');
  assert.deepEqual(urls, ['https://www.boredefi.com/api/gas']);
});

test('fetchGasSnapshot falls back to free public RPCs when the API is down', async () => {
  const methods: string[] = [];
  const fetchImpl = async (url: string, init?: Record<string, unknown>) => {
    if (url.startsWith('https://www.boredefi.com')) {
      return reply({}, false);
    }
    const body = JSON.parse(String(init?.body)) as { method: string };
    methods.push(`${new URL(url).host}:${body.method}`);
    if (url.includes('publicnode')) {
      return reply({}, false); // first RPC is down: next one answers
    }
    switch (body.method) {
      case 'eth_feeHistory':
        return reply({ result: { baseFeePerGas: ['0x3b9aca00', '0x77359400'], reward: [['0x1', '0x5f5e100', '0x3b9aca00']] } });
      case 'eth_blockNumber':
        return reply({ result: '0x10' });
      case 'eth_gasPrice':
        return reply({ result: '0x174876e800' });
      default:
        return reply({ error: { message: 'no' } });
    }
  };
  const snap = await fetchGasSnapshot(fetchImpl, async () => ({ ethUsd: 2000, apeUsd: 0.1 }));
  assert.equal(snap.source, 'rpc');
  assert.equal(snap.baseFeeGwei, 2);
  assert.ok(Math.abs(snap.average.gwei - 2.1) < 1e-9);
  assert.equal(snap.fast.gwei, 3);
  assert.equal(snap.latestBlock, 16);
  assert.deepEqual(snap.apeChain, { gasPriceGwei: 100, apeUsd: 0.1 });
  assert.ok(methods.some((item) => item.startsWith('eth.drpc.org:eth_feeHistory')));
  assert.ok(methods.some((item) => item.startsWith('rpc.apechain.com:eth_gasPrice')));
});

test('24h history: parses the API, falls back to bucketed eth_feeHistory pages', async () => {
  const points = Array.from({ length: 48 }, (_, index) => ({ block: index, time: 1_000 + index * 1800, avgGwei: 0.2 + index / 100, minGwei: 0.1, maxGwei: 0.9 }));
  const parsed = parseGasHistory({ coveredHours: 23.96, points });
  assert.equal(parsed.points.length, 48);
  assert.equal(parsed.coveredHours, 23.96);
  assert.throws(() => parseGasHistory({ points: [points[0]] }));

  const fallback = await fetchGasHistory(async (url, init) => {
    if (url.startsWith('https://www.boredefi.com')) {
      return reply({}, false);
    }
    const body = JSON.parse(String(init?.body)) as { method: string };
    if (body.method === 'eth_blockNumber') {
      return reply({ result: '0x2000' });
    }
    return reply({ result: { baseFeePerGas: Array.from({ length: 1025 }, () => '0x3b9aca00') } });
  });
  assert.equal(fallback.source, 'rpc');
  assert.ok(fallback.points.length >= 40);
  assert.ok(fallback.coveredHours > 23 && fallback.coveredHours < 25);
  assert.equal(fallback.points[0]!.avgGwei, 1);
});

test('bucketBaseFees: avg/min/max per bucket', () => {
  const buckets = bucketBaseFees([1, 3, 5, 7, 9], 0, 12, 2);
  assert.deepEqual(buckets.map((item) => [item.avgGwei, item.minGwei, item.maxGwei]), [[2, 1, 3], [6, 5, 7], [9, 9, 9]]);
  assert.equal(buckets[0]!.time, 12);
});

test('dollar costs and formatting match boredefi.com/gas', () => {
  assert.deepEqual(TYPICAL_ACTIONS.map((item) => item.gas), [21_000, 65_000, 85_000, 180_000]);
  const swap = gasCostUsd(180_000, 0.44, 2290.57)!;
  assert.ok(Math.abs(swap - 0.1814) < 0.001);
  assert.equal(formatUsdFee(swap), '$0.18');
  assert.equal(formatUsdFee(0.004), '<$0.01');
  assert.equal(formatUsdFee(1234.4), '$1,234');
  assert.equal(formatUsdFee(null), '—');
  assert.equal(gasCostUsd(21_000, 1, null), null);
  assert.equal(formatGwei(0.4414), '0.441');
  assert.equal(formatGwei(2.384), '2.38');
  assert.equal(formatGwei(24.33), '24.3');
  assert.equal(formatGwei(101.68), '102');
  assert.equal(formatGwei(0.0012), '0.0012');
  assert.equal(gasLevel(0.4).tone, 'good');
  assert.equal(gasLevel(12).tone, 'ok');
  assert.equal(gasLevel(80).tone, 'busy');
  assert.ok(GAS_REFRESH_MS >= 10_000 && GAS_REFRESH_MS <= 15_000);
});

test('chartPath scales points into the box', () => {
  const { line, area, min, max } = chartPath(
    [
      { time: 0, avgGwei: 1, minGwei: 1, maxGwei: 1 },
      { time: 50, avgGwei: 3, minGwei: 3, maxGwei: 3 },
      { time: 100, avgGwei: 2, minGwei: 2, maxGwei: 2 },
    ],
    108,
    58,
    4,
  );
  assert.equal(line, 'M4 54 L54 4 L104 29');
  assert.ok(area.endsWith('L104 54 L4 54 Z'));
  assert.deepEqual([min, max], [1, 3]);
  assert.equal(chartPath([], 10, 10).line, '');
});
