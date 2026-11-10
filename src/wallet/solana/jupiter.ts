/**
 * Native Solana swap through Jupiter Ultra, using the same server Mevvy uses.
 *
 * GET  {proxy}/api/jupiter/order    → Jupiter Ultra /order; the server adds the API key, referralAccount and
 *                                     referralFee (50 bps), so the referral account is not in the app.
 * POST {proxy}/api/jupiter/execute  → Jupiter Ultra /execute with the transaction the wallet signed itself.
 *
 * The wallet checks the order before it signs: same mints and amount, a fee no higher than 0.5%, the wallet is a
 * required signer, and none of the drainer red flags reviewSolanaTransaction looks for (Assign, token Approve,
 * SetAuthority). The secret key never leaves the device; only the signed transaction is sent.
 */
import { JUPITER_REFERRAL_FEE_BPS, SOLANA_SWAP_PROXY } from '../swap-config';
import {
  fetchWithTimeout,
  isAbortError,
  retryBusyResponse,
  SWAP_EXECUTE_TIMEOUT_MS,
  SWAP_QUOTE_TIMEOUT_MS,
} from '../swap-request';
import {
  decodeWireTransaction,
  parseSolanaTransaction,
  reviewSolanaTransaction,
  signSolanaWcTransaction,
  type SolanaSigner,
  type SolanaTxReview,
} from './wc-solana';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** Jupiter's own swap programs (Aggregator v6 and the Ultra / order-engine programs). */
export const JUPITER_PROGRAM_IDS: ReadonlySet<string> = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  '61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH',
]);

/**
 * The generic WalletConnect review warns about any program it can't decode. In the swap screen the Jupiter
 * program is expected, so that one warning is dropped when Jupiter is the only unknown program.
 */
export function swapReviewWarnings(review: SolanaTxReview, knownNames: readonly string[]): string[] {
  const unknown = review.programs.filter((name) => !knownNames.includes(name) && !JUPITER_PROGRAM_IDS.has(name));
  if (unknown.length > 0) {
    return review.warnings;
  }
  return review.warnings.filter((line) => !/^Runs (a program|programs) BoreDefi can't decode/.test(line));
}

const DECODED_PROGRAM_NAMES = ['System', 'Compute budget', 'Associated token account', 'SPL Token', 'Token-2022', 'Memo'];

export type JupiterOrderPayload = {
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  priceImpactPct?: string | number;
  priceImpact?: number;
  feeBps?: number;
  feeMint?: string;
  platformFee?: { feeBps?: number; feeMint?: string } | null;
  referralAccount?: string | null;
  signatureFeeLamports?: number;
  prioritizationFeeLamports?: number;
  rentFeeLamports?: number;
  gasless?: boolean;
  transaction?: string | null;
  requestId?: string;
  lastValidBlockHeight?: string | number;
  inUsdValue?: number;
  outUsdValue?: number;
  router?: string;
  taker?: string | null;
  errorCode?: number;
  errorMessage?: string;
  error?: string;
};

export type JupiterOrder = {
  inputMint: string;
  outputMint: string;
  inAmount: bigint;
  outAmount: bigint;
  minOutAmount: bigint;
  slippageBps: number;
  /** Percent (0.05 = 0.05%). Negative means the route beats the market price. */
  priceImpactPct: number | null;
  feeBps: number;
  feeMint: string | null;
  /** True when the server attached a referral account, i.e. the 0.5% fee is actually collected. */
  referralConfigured: boolean;
  /** Lamports the wallet pays for signatures, priority and new accounts (0 when gasless). */
  networkFeeLamports: bigint;
  gasless: boolean;
  inUsd: number | null;
  outUsd: number | null;
  router: string;
  requestId: string;
  lastValidBlockHeight: string | number | null;
  /** base64 unsigned transaction; null for a price-only order (no taker). */
  transaction: string | null;
  review: SolanaTxReview | null;
};

function big(value: string | undefined, field: string): bigint {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`The Jupiter order is missing ${field}. Get a new quote.`);
  }
  return BigInt(value);
}

/** Same wording as Mevvy for Ultra's errorCode values. */
export function jupiterOrderErrorMessage(payload: JupiterOrderPayload): string | null {
  if (payload.transaction) {
    return null;
  }
  switch (payload.errorCode) {
    case 1:
      return 'Not enough of the token you are selling for this swap.';
    case 2:
      return 'Not enough SOL for Solana network fees. Keep a little SOL in the wallet for fees.';
    case 3:
      return 'This swap is too small. Try a larger amount.';
    default:
      return payload.errorMessage || payload.error || null;
  }
}

function usd(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Pure: checks an Ultra order against the request and the wallet. */
export function parseJupiterOrder(
  payload: JupiterOrderPayload,
  expected: { inputMint: string; outputMint: string; amount: bigint; taker?: string | null },
): JupiterOrder {
  if (payload.inputMint !== expected.inputMint || payload.outputMint !== expected.outputMint) {
    throw new Error('The Jupiter order was for different tokens. Get a new quote.');
  }
  const inAmount = big(payload.inAmount, 'the amount');
  if (inAmount !== expected.amount) {
    throw new Error('The Jupiter order was for a different amount. Get a new quote.');
  }
  const outAmount = big(payload.outAmount, 'the amount you receive');
  const minOutAmount = big(payload.otherAmountThreshold ?? payload.outAmount, 'the minimum you receive');
  if (outAmount <= 0n || minOutAmount <= 0n || minOutAmount > outAmount) {
    throw new Error('No route available');
  }
  const feeBps = Number(payload.platformFee?.feeBps ?? payload.feeBps ?? 0);
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > JUPITER_REFERRAL_FEE_BPS) {
    throw new Error('The swap fee in this order is higher than BoreDefi charges. Nothing was sent.');
  }
  if (!payload.requestId) {
    throw new Error('The Jupiter order has no request id. Get a new quote.');
  }
  let review: SolanaTxReview | null = null;
  const transaction = payload.transaction ?? null;
  if (expected.taker) {
    if (!transaction) {
      throw new Error(jupiterOrderErrorMessage(payload) ?? 'Jupiter did not return a transaction to sign.');
    }
    if (payload.taker && payload.taker !== expected.taker) {
      throw new Error('The Jupiter order is for a different wallet. Nothing was signed.');
    }
    const tx = parseSolanaTransaction(decodeWireTransaction(transaction));
    if (!tx.staticKeys.slice(0, tx.numRequiredSignatures).includes(expected.taker)) {
      throw new Error('This Solana transaction does not need your wallet to sign. Nothing was signed.');
    }
    const raw = reviewSolanaTransaction(tx, expected.taker);
    review = { ...raw, warnings: swapReviewWarnings(raw, DECODED_PROGRAM_NAMES) };
    if (review.danger) {
      throw new Error(`Blocked: ${review.warnings[0] ?? 'this transaction could hand over your funds'}. Nothing was signed.`);
    }
  }
  const impactRaw = payload.priceImpactPct ?? null;
  const impactNum = impactRaw === null ? null : Number(impactRaw);
  const gasless = payload.gasless === true;
  const lamports = (value: number | undefined) => (Number.isFinite(value) && (value as number) > 0 ? BigInt(Math.round(value as number)) : 0n);
  return {
    inputMint: payload.inputMint,
    outputMint: payload.outputMint,
    inAmount,
    outAmount,
    minOutAmount,
    slippageBps: Number(payload.slippageBps ?? 0),
    // Ultra's priceImpactPct is a fraction ("-0.0051" = -0.51%); priceImpact is already in percent.
    priceImpactPct:
      typeof payload.priceImpact === 'number' && Number.isFinite(payload.priceImpact)
        ? payload.priceImpact
        : impactNum !== null && Number.isFinite(impactNum)
          ? impactNum * 100
          : null,
    feeBps,
    feeMint: payload.platformFee?.feeMint ?? payload.feeMint ?? null,
    referralConfigured: typeof payload.referralAccount === 'string' && payload.referralAccount.length > 0,
    networkFeeLamports: gasless
      ? 0n
      : lamports(payload.signatureFeeLamports) + lamports(payload.prioritizationFeeLamports) + lamports(payload.rentFeeLamports),
    gasless,
    inUsd: usd(payload.inUsdValue),
    outUsd: usd(payload.outUsdValue),
    router: payload.router ?? 'jupiter',
    requestId: payload.requestId,
    lastValidBlockHeight: payload.lastValidBlockHeight ?? null,
    transaction,
    review,
  };
}

export type JupiterOrderInput = {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  taker?: string | null;
  slippageBps?: number;
  proxy?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export function jupiterOrderUrl(input: JupiterOrderInput): string {
  const params = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount.toString(),
  });
  if (input.taker) {
    params.set('taker', input.taker);
  }
  if (input.slippageBps !== undefined) {
    params.set('slippageBps', String(input.slippageBps));
  }
  return `${input.proxy ?? SOLANA_SWAP_PROXY}/api/jupiter/order?${params.toString()}`;
}

export async function fetchJupiterOrder(input: JupiterOrderInput): Promise<JupiterOrder> {
  if (input.inputMint === input.outputMint) {
    throw new Error('Choose two different tokens.');
  }
  if (input.amount <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }
  const run = input.fetcher ?? fetch;
  const timeoutMs = input.timeoutMs ?? SWAP_QUOTE_TIMEOUT_MS;
  let response: Response;
  try {
    // 429/5xx only, and only for /order: 1–2 retries with 500ms then 1500ms. Timeouts and execute are never retried.
    response = await retryBusyResponse(
      () => fetchWithTimeout(run, jupiterOrderUrl(input), { headers: { Accept: 'application/json' } }, timeoutMs),
      { sleep: input.sleep },
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('The network took too long while getting a Solana swap quote from Jupiter. Try again.');
    }
    throw new Error('Network problem while getting a Solana swap quote from Jupiter. Try again.');
  }
  const payload = (await response.json().catch(() => ({}))) as JupiterOrderPayload;
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      throw new Error('The swap service is busy. Try again in a moment.');
    }
    throw new Error(payload.error || jupiterOrderErrorMessage(payload) || 'Jupiter could not price this swap.');
  }
  return parseJupiterOrder(payload, input);
}

/** Signs the order's transaction with the wallet's own key. Returns the base64 signed transaction. */
export function signJupiterOrder(order: JupiterOrder, wallet: string, sign: SolanaSigner): { signature: string; signedTransaction: string } {
  if (!order.transaction) {
    throw new Error('This order has no transaction to sign. Get a new quote.');
  }
  const { signature, transaction } = signSolanaWcTransaction({ transaction: order.transaction }, wallet, sign);
  return { signature, signedTransaction: transaction };
}

export type JupiterExecutePayload = {
  status?: string;
  code?: number;
  signature?: string;
  error?: string;
  totalOutputAmount?: string;
  outputAmountResult?: string;
};

export type JupiterExecuteResult = { signature: string; outputAmount: bigint | null };

export function jupiterExecuteErrorMessage(payload: JupiterExecutePayload): string {
  if (payload.error) {
    return payload.error;
  }
  switch (payload.code) {
    case -1:
      return 'The quote expired before the swap was sent. Get a new quote and try again.';
    case -2:
      return 'The signed transaction was rejected as invalid. Nothing was swapped.';
    case -3:
      return 'The signed message was rejected. Nothing was swapped.';
    default:
      return 'The swap did not go through. Nothing was swapped. Check Activity, then try again.';
  }
}

/** Pure: reads the execute answer; success only for status "Success" / code 0 with our own signature. */
export function parseJupiterExecute(payload: JupiterExecutePayload, signature: string): JupiterExecuteResult {
  const ok = payload.status === 'Success' || payload.code === 0;
  if (!ok) {
    throw new Error(jupiterExecuteErrorMessage(payload));
  }
  if (payload.signature && payload.signature !== signature) {
    throw new Error('Jupiter returned an unexpected transaction id. Check Activity before you try again.');
  }
  const out = payload.totalOutputAmount ?? payload.outputAmountResult;
  return { signature, outputAmount: out && /^\d+$/.test(out) ? BigInt(out) : null };
}

export async function executeJupiterOrder(input: {
  order: JupiterOrder;
  signature: string;
  signedTransaction: string;
  proxy?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<JupiterExecuteResult> {
  const run = input.fetcher ?? fetch;
  let response: Response;
  try {
    // One shot only: never retry execute. A timeout uses the same "may still go through" wording as a drop.
    response = await fetchWithTimeout(
      run,
      `${input.proxy ?? SOLANA_SWAP_PROXY}/api/jupiter/execute`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: input.signedTransaction,
          requestId: input.order.requestId,
          lastValidBlockHeight: input.order.lastValidBlockHeight ?? undefined,
        }),
      },
      input.timeoutMs ?? SWAP_EXECUTE_TIMEOUT_MS,
    );
  } catch {
    // The signed transaction may already be on its way; never say "nothing happened" here.
    throw new Error('Network problem while sending the swap. It may still go through: check Activity before you try again.');
  }
  const payload = (await response.json().catch(() => ({}))) as JupiterExecutePayload;
  if (!response.ok && payload.code === undefined && !payload.status) {
    throw new Error(payload.error || 'The swap service is busy. Check Activity before you try again.');
  }
  return parseJupiterExecute(payload, input.signature);
}

export type SwapTokenInfo = { mint: string; symbol: string; decimals: number };

function units(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''}`;
}

/** Rows for the Solana swap quote card and confirm sheet. */
export function jupiterSummaryRows(order: JupiterOrder, from: SwapTokenInfo, to: SwapTokenInfo): Array<{ label: string; value: string }> {
  const feeToken = order.feeMint === from.mint ? from : order.feeMint === to.mint ? to : null;
  const feeBase = feeToken === from ? order.inAmount : order.outAmount;
  const feeAmount = feeToken ? (feeBase * BigInt(order.feeBps)) / 10_000n : 0n;
  const impact = order.priceImpactPct;
  return [
    { label: 'You receive (est.)', value: `${units(order.outAmount, to.decimals)} ${to.symbol}` },
    { label: 'Minimum received', value: `${units(order.minOutAmount, to.decimals)} ${to.symbol}` },
    {
      label: 'Price impact',
      value: impact === null || !Number.isFinite(impact) ? 'Not reported' : impact < 0.01 ? '<0.01%' : `${impact.toFixed(2)}%`,
    },
    {
      label: 'Network fee (est.)',
      value: order.gasless ? 'Paid by Jupiter (gasless)' : `${units(order.networkFeeLamports, 9)} SOL`,
    },
    {
      label: 'BoreDefi fee',
      value:
        order.feeBps > 0 && order.referralConfigured
          ? `${(order.feeBps / 100).toFixed(2)}%${feeToken && feeAmount > 0n ? ` · ${units(feeAmount, feeToken.decimals)} ${feeToken.symbol}` : ''}`
          : 'None',
    },
    { label: 'Route', value: `Jupiter Ultra (${order.router})` },
  ];
}
