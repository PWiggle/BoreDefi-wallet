import assert from 'node:assert/strict';
import test from 'node:test';

import { ed25519 } from '@noble/curves/ed25519';

import { mnemonicToSeed } from '../mnemonic';
import { createSolanaRpc } from './rpc';
import { solanaKeypairFromSeed } from './derive';
import { decodeBase58 } from './base58';
import {
  broadcastAndConfirm,
  CU_LIMIT_SOL,
  formatLamports,
  friendlySolanaError,
  maxSolSendable,
  planSolanaSend,
  priorityFeeLamports,
  signPlan,
  simulatePlanUnsigned,
  type SolanaSendInput,
} from './send';
import { RENT_EXEMPT_SYSTEM_ACCOUNT, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID } from './programs';
import { associatedTokenAddress } from './tx';

const A = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const B = 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 1_000_000_000n;

function solInput(patch: Partial<SolanaSendInput> = {}): SolanaSendInput {
  return {
    from: A,
    to: B,
    amount: SOL / 10n,
    asset: { kind: 'sol' },
    solBalance: SOL,
    recipient: { exists: true, owner: SYSTEM_PROGRAM_ID, lamports: SOL },
    priorityMicroLamports: 10_000n,
    ...patch,
  };
}

const usdcAsset = { kind: 'spl' as const, mint: USDC, symbol: 'USDC', decimals: 6, programId: TOKEN_PROGRAM_ID, sourceAccount: associatedTokenAddress(A, USDC), balance: 10_000_000n };

test('fee math: 5000 lamports per signature plus priority × compute limit, rounded up', () => {
  assert.equal(priorityFeeLamports(10_000n, 1_000), 10n);
  assert.equal(priorityFeeLamports(1n, 1), 1n);
  assert.equal(priorityFeeLamports(0n, 80_000), 0n);
  const result = planSolanaSend(solInput());
  assert.ok(result.ok);
  assert.equal(result.plan.feeLamports, 5_010n);
  assert.equal(result.plan.computeUnitLimit, CU_LIMIT_SOL);
  assert.equal(result.plan.instructions.length, 3);
});

test('SOL send guards: own address, zero, too much, dust left behind, new account minimum', () => {
  const msg = (r: ReturnType<typeof planSolanaSend>) => (r.ok ? '' : r.message);
  assert.match(msg(planSolanaSend(solInput({ to: A }))), /your own/);
  assert.match(msg(planSolanaSend(solInput({ amount: 0n }))), /greater than zero/);
  assert.match(msg(planSolanaSend(solInput({ amount: SOL }))), /Not enough SOL/);
  assert.match(msg(planSolanaSend(solInput({ amount: SOL - 5_010n - 1_000n }))), /Leave at least/);
  assert.match(
    msg(planSolanaSend(solInput({ amount: 1_000n, recipient: { exists: false, owner: null, lamports: 0n } }))),
    /never been used/,
  );
  assert.ok(planSolanaSend(solInput({ amount: RENT_EXEMPT_SYSTEM_ACCOUNT, recipient: { exists: false, owner: null, lamports: 0n } })).ok);
  // Live (lower) rent minimum from RPC is honoured when supplied.
  assert.ok(planSolanaSend(solInput({ amount: 650_240n, systemAccountRent: 650_240n, recipient: { exists: false, owner: null, lamports: 0n } })).ok);
  assert.match(msg(planSolanaSend(solInput({ amount: SOL - 5_010n - 1_000n, systemAccountRent: 650_240n }))), /Leave at least 0.00065024 SOL/);
  // Max leaves exactly zero, which is allowed.
  assert.ok(planSolanaSend(solInput({ amount: maxSolSendable(SOL, 10_000n) })).ok);
});

test('blocks sends to token accounts and caps absurd priority fees', () => {
  const r = planSolanaSend(solInput({ recipient: { exists: true, owner: TOKEN_PROGRAM_ID, lamports: 2_039_280n } }));
  assert.equal(r.ok, false);
  const capped = planSolanaSend(solInput({ priorityMicroLamports: 10n ** 15n }));
  assert.ok(capped.ok);
  assert.equal(capped.plan.priorityMicroLamports, 2_000_000n);
});

test('SPL send creates the recipient token account when missing and charges its rent', () => {
  const r = planSolanaSend(solInput({ asset: usdcAsset, amount: 2_500_000n, recipientAtaExists: false, tokenAccountRent: 2_039_280n }));
  assert.ok(r.ok);
  assert.equal(r.plan.createsTokenAccount, true);
  assert.equal(r.plan.rentLamports, 2_039_280n);
  assert.equal(r.plan.destinationAccount, associatedTokenAddress(B, USDC));
  assert.equal(r.plan.instructions.length, 4);
  assert.match(r.plan.warnings.join(' '), /no USDC account yet/);
  const existing = planSolanaSend(solInput({ asset: usdcAsset, amount: 2_500_000n, recipientAtaExists: true }));
  assert.ok(existing.ok);
  assert.equal(existing.plan.instructions.length, 3);
  assert.equal(existing.plan.rentLamports, 0n);
});

test('SPL send guards: token balance, SOL for fees, PDA owners, unknown ATA state', () => {
  const msg = (r: ReturnType<typeof planSolanaSend>) => (r.ok ? '' : r.message);
  assert.match(msg(planSolanaSend(solInput({ asset: usdcAsset, amount: 10_000_001n, recipientAtaExists: true }))), /Not enough USDC/);
  assert.match(msg(planSolanaSend(solInput({ asset: usdcAsset, amount: 1n, recipientAtaExists: false, solBalance: 1_000_000n }))), /Not enough SOL/);
  assert.match(msg(planSolanaSend(solInput({ asset: usdcAsset, amount: 1n, to: associatedTokenAddress(B, USDC), recipientAtaExists: true }))), /program account/);
  assert.match(msg(planSolanaSend(solInput({ asset: usdcAsset, amount: 1n }))), /Could not check/);
});

test('formatLamports and friendly errors', () => {
  assert.equal(formatLamports(1_500_000_000n), '1.5');
  assert.equal(formatLamports(890_880n), '0.00089088');
  assert.equal(formatLamports(2_039_280n, 5), '0.00203');
  assert.match(friendlySolanaError({ InstructionError: [0, { Custom: 1 }] }), /Not enough tokens/);
  assert.match(friendlySolanaError({ InsufficientFundsForRent: { account_index: 0 } }), /keep the account open/);
  assert.match(friendlySolanaError('BlockhashNotFound'), /Review it again/);
  // Seen live: the public "abandon … about" test account was reassigned to a program, so it cannot pay fees.
  assert.match(friendlySolanaError('InvalidAccountForFee'), /cannot pay network fees/);
});

test('signPlan produces a transaction signed by the derived key; broadcast simulates first and waits for confirmation', async () => {
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const keypair = solanaKeypairFromSeed(await mnemonicToSeed(phrase));
  const r = planSolanaSend(solInput());
  assert.ok(r.ok);
  const methods: string[] = [];
  let signature = '';
  const fetcher = (async (_url: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body) as { method: string };
    methods.push(method);
    const result =
      method === 'getLatestBlockhash'
        ? { context: { slot: 1 }, value: { blockhash: '9sHcv6xwn9YkB8nxTUGKDwPwNnmqVp5oAXxU8Fdkm4J6', lastValidBlockHeight: 100 } }
        : method === 'simulateTransaction'
          ? { context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 450 } }
          : method === 'sendTransaction'
            ? signature
            : method === 'getSignatureStatuses'
              ? { context: { slot: 1 }, value: [{ confirmationStatus: 'confirmed', err: null }] }
              : 0;
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) } as Response;
  }) as unknown as typeof fetch;
  const rpc = createSolanaRpc(['https://x'], fetcher);
  const signed = await signPlan(phrase, A, r.plan, rpc);
  signature = signed.signature;
  // Wire = [1][sig 64][message]; the signature verifies over the message with the derived public key.
  assert.equal(signed.wire[0], 1);
  const sig = signed.wire.slice(1, 65);
  assert.ok(ed25519.verify(sig, signed.wire.slice(65), keypair.publicKey));
  assert.deepEqual(decodeBase58(signed.signature), sig);
  await assert.rejects(signPlan(phrase, B, r.plan, rpc), /does not match/);
  const outcome = await broadcastAndConfirm(signed, rpc, async () => {});
  assert.deepEqual(outcome, { signature, status: 'confirmed' });
  assert.deepEqual(methods, ['getLatestBlockhash', 'simulateTransaction', 'sendTransaction', 'getSignatureStatuses']);
});

test('review-time simulation sends an UNSIGNED transaction (zero signature, sigVerify off)', async () => {
  const r = planSolanaSend(solInput());
  assert.ok(r.ok);
  let params: any[] = [];
  const fetcher = (async (_url: string, init: { body: string }) => {
    params = JSON.parse(init.body).params;
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: { err: null, logs: [] } } }) } as Response;
  }) as unknown as typeof fetch;
  const sim = await simulatePlanUnsigned(A, r.plan, createSolanaRpc(['https://x'], fetcher));
  assert.equal(sim.err, null);
  assert.equal(params[1].sigVerify, false);
  assert.equal(params[1].replaceRecentBlockhash, true);
  const wire = Uint8Array.from(Buffer.from(params[0], 'base64'));
  assert.equal(wire[0], 1);
  assert.ok(wire.slice(1, 65).every((b) => b === 0));
});

test('broadcast refuses to send when simulation fails', async () => {
  const fetcher = (async (_url: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body) as { method: string };
    assert.notEqual(method, 'sendTransaction');
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: { err: { InsufficientFundsForRent: { account_index: 0 } }, logs: [] } } }),
    } as Response;
  }) as unknown as typeof fetch;
  const rpc = createSolanaRpc(['https://x'], fetcher);
  await assert.rejects(
    broadcastAndConfirm({ wire: new Uint8Array([1]), signature: 'x', lastValidBlockHeight: 1 }, rpc, async () => {}),
    /keep the account open/,
  );
});
