import assert from 'node:assert/strict';
import test from 'node:test';

import { createSolanaRpc, getSolBalance, medianPriorityFee, parseTokenAccounts, SolanaRpcError } from './rpc';
import { TOKEN_PROGRAM_ID } from './programs';

type Call = { url: string; body: { method: string; params: unknown[] } };

function fakeFetch(responses: Array<(call: Call) => { status?: number; json?: unknown } | Error>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: { body: string }) => {
    const call = { url, body: JSON.parse(init.body) };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error('no response');
    const res = next(call);
    if (res instanceof Error) throw res;
    return { ok: (res.status ?? 200) < 400, status: res.status ?? 200, json: async () => res.json } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

test('falls back to the next public RPC on HTTP 429 and transport errors', async () => {
  const { calls, fetcher } = fakeFetch([
    () => ({ status: 429 }),
    () => new Error('network down'),
    () => ({ json: { jsonrpc: '2.0', id: 3, result: { context: { slot: 1 }, value: 1_500_000_000 } } }),
  ]);
  const rpc = createSolanaRpc(['https://a', 'https://b', 'https://c'], fetcher);
  assert.equal(await getSolBalance('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', rpc), 1_500_000_000n);
  assert.deepEqual(calls.map((c) => c.url), ['https://a', 'https://b', 'https://c']);
  assert.equal(calls[0]!.body.method, 'getBalance');
});

test('a JSON-RPC error is final and not retried on other endpoints', async () => {
  const { calls, fetcher } = fakeFetch([
    () => ({ json: { jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Transaction simulation failed' } } }),
  ]);
  const rpc = createSolanaRpc(['https://a', 'https://b'], fetcher);
  await assert.rejects(rpc('sendTransaction', []), (err: unknown) => err instanceof SolanaRpcError && err.code === -32002);
  assert.equal(calls.length, 1);
});

test('parses jsonParsed token accounts and skips frozen or malformed rows', () => {
  const rows = [
    { pubkey: 'acc1', account: { owner: TOKEN_PROGRAM_ID, data: { parsed: { info: { mint: 'm1', tokenAmount: { amount: '42', decimals: 6 }, state: 'initialized' } } } } },
    { pubkey: 'acc2', account: { owner: TOKEN_PROGRAM_ID, data: { parsed: { info: { mint: 'm2', tokenAmount: { amount: '5', decimals: 6 }, state: 'frozen' } } } } },
    { pubkey: 'acc3', account: { owner: TOKEN_PROGRAM_ID, data: { parsed: { info: { mint: 'm3', tokenAmount: { amount: 'x', decimals: 6 } } } } } },
  ];
  assert.deepEqual(parseTokenAccounts(rows, TOKEN_PROGRAM_ID), [
    { mint: 'm1', account: 'acc1', amount: 42n, decimals: 6, programId: TOKEN_PROGRAM_ID },
  ]);
});

test('priority fee estimate is the median of non-zero recent fees', () => {
  assert.equal(medianPriorityFee([]), 0n);
  assert.equal(medianPriorityFee([0, 0, 0]), 0n);
  assert.equal(medianPriorityFee([0, 100, 5000, 300]), 300n);
});
