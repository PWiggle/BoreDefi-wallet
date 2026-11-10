import assert from 'node:assert/strict';
import test from 'node:test';

import { ed25519 } from '@noble/curves/ed25519';
import { base64 } from '@scure/base';

import { decodeBase58, encodeBase58 } from './base58';
import { keypairFromSecret, signSolanaMessage } from './derive';
import { TOKEN_PROGRAM_ID } from './programs';
import { compileMessage, serializeMessage, serializeTransaction, setComputeUnitLimit, type Instruction } from './tx';
import { parseSolanaTransaction } from './wc-solana';
import {
  executeJupiterOrder,
  fetchJupiterOrder,
  jupiterOrderUrl,
  jupiterSummaryRows,
  parseJupiterExecute,
  parseJupiterOrder,
  signJupiterOrder,
  WSOL_MINT,
  type JupiterOrderPayload,
} from './jupiter';

// Throwaway test keys (fixed bytes). Never a real wallet.
const ME = keypairFromSecret(new Uint8Array(32).fill(3));
const OTHER = keypairFromSecret(new Uint8Array(32).fill(4));
const BLOCKHASH = encodeBase58(new Uint8Array(32).fill(9));
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const sign = (bytes: Uint8Array) => signSolanaMessage(ME, bytes);

function wire(instructions: Instruction[], feePayer = ME.address): string {
  const compiled = compileMessage(feePayer, instructions, BLOCKHASH);
  const message = serializeMessage(compiled);
  return base64.encode(serializeTransaction(Array.from({ length: compiled.header.numRequiredSignatures }, () => new Uint8Array(64)), message));
}

const jupiterSwap: Instruction = {
  programId: JUP6,
  accounts: [
    { address: ME.address, isSigner: true, isWritable: true },
    { address: OTHER.address, isSigner: false, isWritable: true },
  ],
  data: new Uint8Array([1, 2, 3]),
};

function order(overrides: Partial<JupiterOrderPayload> = {}): JupiterOrderPayload {
  return {
    inputMint: WSOL_MINT,
    outputMint: USDC,
    inAmount: '10000000',
    outAmount: '852529',
    otherAmountThreshold: '851397',
    slippageBps: 15,
    priceImpactPct: '-0.0051',
    priceImpact: -0.51,
    feeBps: 50,
    feeMint: WSOL_MINT,
    platformFee: { feeBps: 50, feeMint: WSOL_MINT },
    referralAccount: 'ReferralAccount1111111111111111111111111111',
    signatureFeeLamports: 5000,
    prioritizationFeeLamports: 2278,
    rentFeeLamports: 0,
    gasless: false,
    transaction: wire([setComputeUnitLimit(200_000), jupiterSwap]),
    requestId: 'req-1',
    router: 'metis',
    taker: ME.address,
    inUsdValue: 0.85,
    outUsdValue: 0.85,
    ...overrides,
  };
}

const expected = { inputMint: WSOL_MINT, outputMint: USDC, amount: 10_000_000n, taker: ME.address };

test('a Jupiter Ultra order parses with the 0.5% referral fee, price impact and network fee', () => {
  const parsed = parseJupiterOrder(order(), expected);
  assert.equal(parsed.outAmount, 852529n);
  assert.equal(parsed.minOutAmount, 851397n);
  assert.equal(parsed.feeBps, 50);
  assert.equal(parsed.referralConfigured, true);
  assert.equal(parsed.priceImpactPct, -0.51);
  assert.equal(parsed.networkFeeLamports, 7278n);
  // Jupiter's own program is expected in a swap, so it is not flagged as "can't decode".
  assert.ok(!(parsed.review?.warnings ?? []).some((line) => line.includes("can't decode")));
  const rows = Object.fromEntries(
    jupiterSummaryRows(parsed, { mint: WSOL_MINT, symbol: 'SOL', decimals: 9 }, { mint: USDC, symbol: 'USDC', decimals: 6 }).map((row) => [row.label, row.value]),
  );
  assert.equal(rows['You receive (est.)'], '0.852529 USDC');
  assert.equal(rows['BoreDefi fee'], '0.50% · 0.00005 SOL');
  assert.equal(rows['Network fee (est.)'], '0.000007 SOL');
  assert.equal(rows['Price impact'], '<0.01%');
});

test('orders for other mints, another amount, another wallet, or a higher fee are refused', () => {
  assert.throws(() => parseJupiterOrder(order({ outputMint: WSOL_MINT }), expected), /different tokens/);
  assert.throws(() => parseJupiterOrder(order({ inAmount: '1' }), expected), /different amount/);
  assert.throws(() => parseJupiterOrder(order({ taker: OTHER.address }), expected), /different wallet/);
  assert.throws(() => parseJupiterOrder(order({ feeBps: 100, platformFee: { feeBps: 100 } }), expected), /higher than BoreDefi/);
  assert.throws(() => parseJupiterOrder(order({ requestId: undefined }), expected), /request id/);
});

test('a transaction our wallet does not sign, or one that approves our tokens away, is blocked', () => {
  const notOurs = order({ transaction: wire([{ ...jupiterSwap, accounts: [{ address: OTHER.address, isSigner: true, isWritable: true }] }], OTHER.address) });
  assert.throws(() => parseJupiterOrder(notOurs, expected), /does not need your wallet/);
  const approve: Instruction = {
    programId: TOKEN_PROGRAM_ID,
    accounts: [
      { address: OTHER.address, isSigner: false, isWritable: true },
      { address: OTHER.address, isSigner: false, isWritable: false },
      { address: ME.address, isSigner: true, isWritable: false },
    ],
    data: new Uint8Array([4, 1, 0, 0, 0, 0, 0, 0, 0]),
  };
  assert.throws(() => parseJupiterOrder(order({ transaction: wire([approve, jupiterSwap]) }), expected), /Blocked/);
});

test('Ultra error codes become plain messages when no transaction comes back', () => {
  assert.throws(() => parseJupiterOrder(order({ transaction: null, errorCode: 2 }), expected), /Not enough SOL/);
  assert.throws(() => parseJupiterOrder(order({ transaction: null, errorCode: 1 }), expected), /Not enough of the token/);
  // A price-only order (no taker) has no transaction and is fine.
  assert.equal(parseJupiterOrder(order({ transaction: null }), { ...expected, taker: null }).transaction, null);
});

test('signing puts our signature in our slot and leaves the message untouched', () => {
  const parsed = parseJupiterOrder(order(), expected);
  const signed = signJupiterOrder(parsed, ME.address, sign);
  const tx = parseSolanaTransaction(base64.decode(signed.signedTransaction));
  assert.equal(encodeBase58(tx.signatures[0]!), signed.signature);
  assert.ok(ed25519.verify(decodeBase58(signed.signature), tx.messageBytes, ME.publicKey));
});

test('execute succeeds only on Success / code 0 with our own signature', () => {
  assert.equal(parseJupiterExecute({ status: 'Success', signature: 'abc', totalOutputAmount: '850000' }, 'abc').outputAmount, 850000n);
  assert.throws(() => parseJupiterExecute({ status: 'Failed', code: -1 }, 'abc'), /expired/);
  assert.throws(() => parseJupiterExecute({ status: 'Success', signature: 'zzz' }, 'abc'), /unexpected transaction id/);
});

test('order and execute go to the Mevvy-compatible proxy; only the signed transaction is sent', async () => {
  const seen: Array<{ url: string; body?: string }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    seen.push({ url, body: init?.body as string | undefined });
    if (url.includes('/order')) {
      return new Response(JSON.stringify(order()), { status: 200 });
    }
    const body = JSON.parse(String(init?.body)) as { signedTransaction: string };
    const tx = parseSolanaTransaction(base64.decode(body.signedTransaction));
    return new Response(JSON.stringify({ status: 'Success', code: 0, signature: encodeBase58(tx.signatures[0]!) }), { status: 200 });
  }) as unknown as typeof fetch;
  const parsed = await fetchJupiterOrder({ ...expected, proxy: 'https://proxy.test', fetcher });
  assert.ok(seen[0]?.url.startsWith('https://proxy.test/api/jupiter/order?'));
  assert.ok(seen[0]?.url.includes(`taker=${ME.address}`));
  const signed = signJupiterOrder(parsed, ME.address, sign);
  const result = await executeJupiterOrder({ order: parsed, ...signed, proxy: 'https://proxy.test', fetcher });
  assert.equal(result.signature, signed.signature);
  const sent = JSON.parse(seen[1]?.body ?? '{}') as Record<string, unknown>;
  assert.deepEqual(Object.keys(sent).sort(), ['requestId', 'signedTransaction']);
  assert.ok(!JSON.stringify(sent).includes(encodeBase58(ME.secretKey)));
  assert.equal(jupiterOrderUrl({ ...expected, slippageBps: 30, proxy: 'https://p' }).includes('slippageBps=30'), true);
});
