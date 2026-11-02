import { Contract, Interface, type TransactionResponse } from 'ethers';

import { logger } from '../logger';
import { friendlyTxError, toUserError, UserFacingError } from './tx-errors';
import { isWrapPair, isWrapperRoute, sameTokenAddress } from './swap-guard';
import { type ChainId } from './chains';
import { connectedWallet, getProvider, readWithFallback, retryRead } from './rpc';
import { isNativeTokenAddress, type TokenConfig } from './tokens';

const QUOTE_URL = 'https://li.quest/v1/quote';
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

export type QuoteToken = { address: string; decimals: number; symbol: string };

export const NO_ROUTE_MESSAGE = 'No route available';

export type SwapQuote = {
  tool: string;
  toolName: string;
  /** Tokens the aggregator actually quoted. Always checked against the user's selection. */
  fromToken: QuoteToken;
  toToken: QuoteToken;
  fromAmountUsd: number | null;
  toAmountUsd: number | null;
  fromAmount: bigint;
  toAmount: bigint;
  toAmountMin: bigint;
  approvalAddress: string | null;
  transactionRequest: {
    to: string;
    data: string;
    value: bigint;
    gasLimit?: bigint;
  };
};

type LiFiQuote = {
  tool?: string;
  toolDetails?: { name?: string };
  action?: {
    fromChainId?: number;
    toChainId?: number;
    fromAmount?: string;
    fromToken?: { address?: string; decimals?: number; symbol?: string };
    toToken?: { address?: string; decimals?: number; symbol?: string };
  };
  estimate?: {
    toAmount?: string;
    toAmountMin?: string;
    approvalAddress?: string;
    fromAmountUSD?: string;
    toAmountUSD?: string;
  };
  includedSteps?: Array<{ type?: string; tool?: string }>;
  transactionRequest?: {
    to?: string;
    data?: string;
    value?: string;
    gasLimit?: string;
  };
  message?: string;
};

/** LI.FI answers 404 "No available quotes" when nothing routes; 429/5xx are temporary. */
export function liFiFailureMessage(status: number, message: string | undefined): string {
  if (status === 429 || status >= 500) {
    return 'The swap service is busy. Try again in a moment.';
  }
  if (status === 404 || /no available quotes|no route|not found/i.test(message ?? '')) {
    return NO_ROUTE_MESSAGE;
  }
  if (/too low|minimum|amount/i.test(message ?? '') && (message ?? '').length < 120) {
    return 'Amount is too small for any route. Try a larger amount.';
  }
  return NO_ROUTE_MESSAGE;
}

export function isSameChainSwap(fromChainId: number, toChainId: number): boolean {
  return fromChainId === toChainId;
}

export function quoteContainsBridge(steps: Array<{ type?: string; tool?: string }> | undefined): boolean {
  return (steps ?? []).some((step) => step.type === 'cross' || step.tool === 'hop' || step.type === 'bridge');
}

function quoteToken(
  raw: { address?: string; decimals?: number; symbol?: string } | undefined,
  expected: TokenConfig | undefined,
): QuoteToken {
  if (!expected) {
    return { address: raw?.address ?? '', decimals: raw?.decimals ?? 18, symbol: raw?.symbol ?? '' };
  }
  if (!raw?.address || !sameTokenAddress(raw.address, expected.address)) {
    throw new UserFacingError('The quote was for a different token. Get a new quote.');
  }
  if (raw.decimals !== undefined && raw.decimals !== expected.decimals) {
    throw new UserFacingError('The quote used the wrong token decimals. Get a new quote.');
  }
  return { address: expected.address, decimals: expected.decimals, symbol: expected.symbol };
}

function usd(value: string | undefined): number | null {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseLiFiQuote(
  payload: LiFiQuote,
  expectedFromChainId: ChainId,
  expectedToChainId: ChainId = expectedFromChainId,
  expectedTokens?: { from: TokenConfig; to: TokenConfig },
): SwapQuote {
  const fromChainId = payload.action?.fromChainId;
  const toChainId = payload.action?.toChainId;
  if (fromChainId === undefined || toChainId === undefined) {
    throw new Error('Quote is missing chain information.');
  }
  if (expectedFromChainId === expectedToChainId) {
    if (!isSameChainSwap(fromChainId, toChainId) || fromChainId !== expectedFromChainId) {
      throw new Error('Use Bridge for cross-chain routes.');
    }
    if (quoteContainsBridge(payload.includedSteps)) {
      throw new Error('That route is a bridge. Use Bridge instead.');
    }
  } else if (
    fromChainId !== expectedFromChainId ||
    toChainId !== expectedToChainId ||
    isSameChainSwap(fromChainId, toChainId)
  ) {
    throw new Error('Use Swap for same-chain routes.');
  }
  const request = payload.transactionRequest;
  if (!request?.to || !request.data) {
    throw new Error('Quote did not include a transaction to sign.');
  }
  const fromToken = quoteToken(payload.action?.fromToken, expectedTokens?.from);
  const toToken = quoteToken(payload.action?.toToken, expectedTokens?.to);
  if (
    isWrapperRoute(payload.tool, payload.includedSteps) &&
    (expectedFromChainId !== expectedToChainId ||
      !expectedTokens ||
      !isWrapPair(expectedFromChainId, expectedTokens.from, expectedTokens.to))
  ) {
    throw new UserFacingError(NO_ROUTE_MESSAGE);
  }
  if (BigInt(payload.estimate?.toAmount ?? '0') <= 0n) {
    throw new UserFacingError(NO_ROUTE_MESSAGE);
  }
  return {
    tool: payload.tool ?? 'aggregator',
    toolName: payload.toolDetails?.name ?? payload.tool ?? 'Best route',
    fromToken,
    toToken,
    fromAmountUsd: usd(payload.estimate?.fromAmountUSD),
    toAmountUsd: usd(payload.estimate?.toAmountUSD),
    fromAmount: BigInt(payload.action?.fromAmount ?? '0'),
    toAmount: BigInt(payload.estimate?.toAmount ?? '0'),
    toAmountMin: BigInt(payload.estimate?.toAmountMin ?? '0'),
    approvalAddress: payload.estimate?.approvalAddress ?? null,
    transactionRequest: {
      to: request.to,
      data: request.data,
      value: BigInt(request.value ?? '0'),
      gasLimit: request.gasLimit ? BigInt(request.gasLimit) : undefined,
    },
  };
}

export async function fetchSwapQuote(input: {
  chainId: ChainId;
  fromToken: TokenConfig;
  toToken: TokenConfig;
  fromAmount: bigint;
  fromAddress: string;
  slippage?: number;
}): Promise<SwapQuote> {
  if (input.fromToken.address.toLowerCase() === input.toToken.address.toLowerCase()) {
    throw new Error('Choose two different tokens.');
  }
  if (input.fromAmount <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }

  const url = new URL(QUOTE_URL);
  url.searchParams.set('fromChain', String(input.chainId));
  url.searchParams.set('toChain', String(input.chainId));
  url.searchParams.set('fromToken', input.fromToken.address);
  url.searchParams.set('toToken', input.toToken.address);
  url.searchParams.set('fromAmount', input.fromAmount.toString());
  url.searchParams.set('fromAddress', input.fromAddress);
  url.searchParams.set('slippage', String(input.slippage ?? 0.005));
  url.searchParams.set('order', 'CHEAPEST');
  url.searchParams.set('integrator', 'boredefi');

  try {
    const response = await fetchWithRetry(() =>
      fetch(url.toString(), {
        headers: { Accept: 'application/json', 'User-Agent': 'BoreDefiWallet/0.3' },
      }),
    );
    const payload = (await response.json()) as LiFiQuote;
    if (!response.ok) {
      throw new UserFacingError(liFiFailureMessage(response.status, payload.message));
    }
    return parseLiFiQuote(payload, input.chainId, input.chainId, { from: input.fromToken, to: input.toToken });
  } catch (error) {
    throw toUserError('Swap quote failed', error, {
      chainId: input.chainId,
      fallback: NO_ROUTE_MESSAGE,
      step: SWAP_STEPS.quote,
    });
  }
}

/** Step names shown in Swap errors ("Network problem while …"). */
export const SWAP_STEPS = {
  quote: 'getting a swap quote from LI.FI',
  bridgeQuote: 'getting a bridge quote from LI.FI',
  balance: (symbol: string) => `loading your ${symbol} balance`,
  prices: 'checking the market price',
} as const;

/**
 * One retry for a request that never got an HTTP answer (dropped cellular connection, "Network request failed").
 * HTTP error statuses are returned as-is; the caller maps them.
 */
export async function fetchWithRetry<R>(
  run: () => Promise<R>,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<R> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(options.delayMs ?? 800);
      }
    }
  }
  throw lastError;
}

export async function fetchTokenBalance(
  owner: string,
  token: TokenConfig,
  chainId: ChainId,
): Promise<bigint> {
  // readWithFallback: one failing public RPC must not fail the read (see rpc.ts).
  if (token.native || isNativeTokenAddress(token.address)) {
    return readWithFallback(chainId, (provider) => provider.getBalance(owner));
  }
  return readWithFallback(
    chainId,
    (provider) => new Contract(token.address, ERC20_ABI, provider).balanceOf(owner) as Promise<bigint>,
  );
}

export type SpendBalanceLoad = { balance: bigint; error: null } | { balance: null; error: string };

/**
 * Balance of the token a Swap or Bridge would spend, for the screen: retried once, and on failure a message that
 * names the step ("Network problem while loading your USDC balance…"). The screen shows "…" and blocks the
 * pre-flight while balance is null, and a later successful load clears the error.
 */
export async function loadSpendBalance(
  owner: string,
  token: TokenConfig,
  chainId: ChainId,
  options: { read?: typeof fetchTokenBalance; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SpendBalanceLoad> {
  const read = options.read ?? fetchTokenBalance;
  try {
    return { balance: await retryRead(() => read(owner, token, chainId), { sleep: options.sleep }), error: null };
  } catch (error) {
    return {
      balance: null,
      error: friendlyTxError(error, {
        chainId,
        step: SWAP_STEPS.balance(token.symbol),
        fallback: `Could not load your ${token.symbol} balance. Try again in a moment.`,
      }),
    };
  }
}

export type ExternalTxSender = (tx: {
  to?: string;
  data?: string;
  value?: bigint;
  gasLimit?: bigint;
  chainId: ChainId;
}) => Promise<string>;

export async function ensureSpendAllowance(input: {
  mnemonic: string;
  token: TokenConfig;
  owner: string;
  spender: string;
  amount: bigint;
  chainId: ChainId;
  sendTx?: ExternalTxSender;
}): Promise<TransactionResponse | null> {
  if (input.token.native || isNativeTokenAddress(input.token.address)) {
    return null;
  }
  try {
    const reader = new Contract(input.token.address, ERC20_ABI, getProvider(input.chainId));
    const allowance = (await reader.allowance(input.owner, input.spender)) as bigint;
    if (allowance >= input.amount) {
      return null;
    }
    logger.info('Submitting token approval', { chainId: input.chainId, spender: input.spender });
    if (input.sendTx) {
      const data = new Interface(ERC20_ABI).encodeFunctionData('approve', [input.spender, input.amount]);
      const hash = await input.sendTx({
        to: input.token.address,
        data,
        value: 0n,
        chainId: input.chainId,
      });
      await getProvider(input.chainId).waitForTransaction(hash);
      return null;
    }
    const wallet = await connectedWallet(input.mnemonic, input.chainId);
    const contract = new Contract(input.token.address, ERC20_ABI, wallet);
    const tx = (await contract.approve(input.spender, input.amount)) as TransactionResponse;
    await tx.wait();
    return tx;
  } catch (error) {
    throw toUserError('Token approval failed', error, {
      chainId: input.chainId,
      fallback: 'Token approval failed. Nothing was swapped.',
    });
  }
}

export async function sendSwapTransaction(
  mnemonic: string,
  quote: SwapQuote,
  chainId: ChainId,
  sendTx?: ExternalTxSender,
): Promise<{ hash: string }> {
  try {
    if (sendTx) {
      const hash = await sendTx({
        to: quote.transactionRequest.to,
        data: quote.transactionRequest.data,
        value: quote.transactionRequest.value,
        gasLimit: quote.transactionRequest.gasLimit,
        chainId,
      });
      return { hash };
    }
    const wallet = await connectedWallet(mnemonic, chainId);
    return await wallet.sendTransaction({
      to: quote.transactionRequest.to,
      data: quote.transactionRequest.data,
      value: quote.transactionRequest.value,
      gasLimit: quote.transactionRequest.gasLimit,
    });
  } catch (error) {
    throw toUserError('Swap send failed', error, {
      chainId,
      fallback: 'Swap transaction failed. Review the quote and try again.',
    });
  }
}

export async function fetchBridgeQuote(input: {
  fromChainId: ChainId;
  toChainId: ChainId;
  fromToken: TokenConfig;
  toToken: TokenConfig;
  fromAmount: bigint;
  fromAddress: string;
  slippage?: number;
}): Promise<SwapQuote> {
  if (input.fromChainId === input.toChainId) {
    throw new Error('Choose two different networks to bridge.');
  }
  if (input.fromAmount <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }
  const url = new URL(QUOTE_URL);
  url.searchParams.set('fromChain', String(input.fromChainId));
  url.searchParams.set('toChain', String(input.toChainId));
  url.searchParams.set('fromToken', input.fromToken.address);
  url.searchParams.set('toToken', input.toToken.address);
  url.searchParams.set('fromAmount', input.fromAmount.toString());
  url.searchParams.set('fromAddress', input.fromAddress);
  url.searchParams.set('toAddress', input.fromAddress);
  url.searchParams.set('slippage', String(input.slippage ?? 0.005));
  url.searchParams.set('order', 'CHEAPEST');
  url.searchParams.set('integrator', 'boredefi');

  try {
    const response = await fetchWithRetry(() =>
      fetch(url.toString(), {
        headers: { Accept: 'application/json', 'User-Agent': 'BoreDefiWallet/0.3' },
      }),
    );
    const payload = (await response.json()) as LiFiQuote;
    if (!response.ok) {
      throw new UserFacingError(liFiFailureMessage(response.status, payload.message));
    }
    return parseLiFiQuote(payload, input.fromChainId, input.toChainId, { from: input.fromToken, to: input.toToken });
  } catch (error) {
    throw toUserError('Bridge quote failed', error, {
      chainId: input.fromChainId,
      fallback: NO_ROUTE_MESSAGE,
      step: SWAP_STEPS.bridgeQuote,
    });
  }
}
