import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSolanaActivity, fetchSolanaActivity, type ParsedTransaction } from './activity';
import { createSolanaRpc } from './rpc';

const A = 'H9xUMrv7dYd3gyGdsCEH7muhm4TyG3qYsbgTPFSndvF1';
const B = 'AeffSFdmXvCf45p15sULWuTtdwYE5o1tRf4gdSJaEkcZ';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SIG = 'fZbvr7N37RKD1P8WtahcRZTWqZdU7BzrEvfjaQMoGwhmBR7Aw4PiYjibmSuqPboiWFcNJe3GA45mkXsrSnazPch';

// Trimmed from the real mainnet proof send (getTransaction jsonParsed, Nov 4 2026).
const REAL_SEND: ParsedTransaction = {
  blockTime: 1793844260,
  meta: { err: null, fee: 5000, preBalances: [20821639, 0, 1, 1], postBalances: [15816639, 5000000, 1, 1], preTokenBalances: [], postTokenBalances: [] },
  transaction: {
    message: {
      accountKeys: [
        { pubkey: A, signer: true },
        { pubkey: B, signer: false },
        { pubkey: 'ComputeBudget111111111111111111111111111111' },
        { pubkey: '11111111111111111111111111111111' },
      ],
    },
  },
};
const info = { signature: SIG, blockTime: 1793844260, err: null, slot: 465529894 };

test('real proof send reads as -0.005 SOL for the sender (fee shown separately) and +0.005 for the receiver', () => {
  const sent = parseSolanaActivity(info, REAL_SEND, A, 'mainnet-beta');
  assert.equal(sent.direction, 'out');
  assert.equal(sent.amount, 5_000_000n);
  assert.equal(sent.feeLamports, 5_000n);
  assert.equal(sent.counterparty, B);
  assert.equal(sent.status, 'confirmed');
  assert.equal(sent.explorerUrl, `https://solscan.io/tx/${SIG}`);
  const got = parseSolanaActivity(info, REAL_SEND, B, 'mainnet-beta');
  assert.equal(got.direction, 'in');
  assert.equal(got.amount, 5_000_000n);
  assert.equal(got.feeLamports, 0n);
  assert.equal(got.counterparty, A);
});

test('known SPL changes win over the SOL fee; unknown mints fall back to SOL', () => {
  const tx: ParsedTransaction = {
    blockTime: 1,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [10_000_000, 0, 0],
      postBalances: [9_995_000, 0, 0],
      preTokenBalances: [{ accountIndex: 1, mint: USDC, owner: A, uiTokenAmount: { amount: '3000000', decimals: 6 } }],
      postTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: A, uiTokenAmount: { amount: '500000', decimals: 6 } },
        { accountIndex: 2, mint: USDC, owner: B, uiTokenAmount: { amount: '2500000', decimals: 6 } },
      ],
    },
    transaction: { message: { accountKeys: [A, 'tokA', 'tokB'] } },
  };
  const row = parseSolanaActivity({ ...info, signature: 'x' }, tx, A, 'mainnet-beta');
  assert.deepEqual([row.direction, row.symbol, row.amount, row.decimals, row.counterparty], ['out', 'USDC', 2_500_000n, 6, B]);
  const spam = structuredClone(tx);
  for (const r of [...spam.meta!.preTokenBalances!, ...spam.meta!.postTokenBalances!]) r.mint = B;
  const fallback = parseSolanaActivity({ ...info, signature: 'x' }, spam, A, 'mainnet-beta');
  assert.equal(fallback.symbol, 'SOL');
  assert.equal(fallback.direction, 'self');
  assert.equal(fallback.feeLamports, 5_000n);
});

test('failed and unreadable transactions still list with status', () => {
  assert.equal(parseSolanaActivity({ ...info, err: { InstructionError: [0, 'x'] } }, REAL_SEND, A).status, 'failed');
  const missing = parseSolanaActivity(info, null, A, 'devnet');
  assert.equal(missing.amount, 0n);
  assert.match(missing.explorerUrl, /cluster=devnet$/);
});

test('fetchSolanaActivity pages signatures then transactions', async () => {
  const methods: string[] = [];
  const fetcher = (async (_u: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body) as { method: string };
    methods.push(method);
    const result = method === 'getSignaturesForAddress' ? [info] : REAL_SEND;
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) } as Response;
  }) as unknown as typeof fetch;
  const rows = await fetchSolanaActivity(A, 5, createSolanaRpc(['https://x'], fetcher));
  assert.deepEqual(methods, ['getSignaturesForAddress', 'getTransaction']);
  assert.equal(rows[0]!.amount, 5_000_000n);
});
