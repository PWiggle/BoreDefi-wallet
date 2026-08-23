import { Contract, type TransactionResponse } from 'ethers';

import { logger } from '../logger';
import { type ChainId } from './chains';
import { connectedWallet, getProvider } from './rpc';
import { isNativeTokenAddress, type TokenConfig } from './tokens';

const QUOTE_URL = 'https://li.quest/v1/quote';
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

export type SwapQuote = {
  tool: string;
  toolName: string;
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
  };
  estimate?: {
    toAmount?: string;
    toAmountMin?: string;
    approvalAddress?: string;
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

export function isSameChainSwap(fromChainId: number, toChainId: number): boolean {
  return fromChainId === toChainId;
}

export function quoteContainsBridge(steps: Array<{ type?: string; tool?: string }> | undefined): boolean {
  return (steps ?? []).some((step) => step.type === 'cross' || step.tool === 'hop' || step.type === 'bridge');
}

export function parseLiFiQuote(
  payload: LiFiQuote,
  expectedFromChainId: ChainId,
  expectedToChainId: ChainId = expectedFromChainId,
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
  return {
    tool: payload.tool ?? 'aggregator',
    toolName: payload.toolDetails?.name ?? payload.tool ?? 'Best route',
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
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'BoreDefiWallet/0.3' },
    });
    const payload = (await response.json()) as LiFiQuote;
    if (!response.ok) {
      throw new Error(payload.message || 'Could not get a swap quote.');
    }
    return parseLiFiQuote(payload, input.chainId, input.chainId);
  } catch (error) {
    logger.error('Swap quote failed', {
      chainId: input.chainId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw error instanceof Error ? error : new Error('Could not get a swap quote.');
  }
}

export async function fetchTokenBalance(
  owner: string,
  token: TokenConfig,
  chainId: ChainId,
): Promise<bigint> {
  if (token.native || isNativeTokenAddress(token.address)) {
    return getProvider(chainId).getBalance(owner);
  }
  const contract = new Contract(token.address, ERC20_ABI, getProvider(chainId));
  return contract.balanceOf(owner) as Promise<bigint>;
}

export async function ensureSpendAllowance(input: {
  mnemonic: string;
  token: TokenConfig;
  owner: string;
  spender: string;
  amount: bigint;
  chainId: ChainId;
}): Promise<TransactionResponse | null> {
  if (input.token.native || isNativeTokenAddress(input.token.address)) {
    return null;
  }
  const wallet = connectedWallet(input.mnemonic, input.chainId);
  const contract = new Contract(input.token.address, ERC20_ABI, wallet);
  const allowance = (await contract.allowance(input.owner, input.spender)) as bigint;
  if (allowance >= input.amount) {
    return null;
  }
  logger.info('Submitting token approval', { chainId: input.chainId, spender: input.spender });
  const tx = (await contract.approve(input.spender, input.amount)) as TransactionResponse;
  await tx.wait();
  return tx;
}

export async function sendSwapTransaction(
  mnemonic: string,
  quote: SwapQuote,
  chainId: ChainId,
): Promise<TransactionResponse> {
  const wallet = connectedWallet(mnemonic, chainId);
  try {
    return await wallet.sendTransaction({
      to: quote.transactionRequest.to,
      data: quote.transactionRequest.data,
      value: quote.transactionRequest.value,
      gasLimit: quote.transactionRequest.gasLimit,
    });
  } catch (error) {
    logger.error('Swap send failed', {
      chainId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Swap transaction failed. Review the quote and try again.');
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
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'BoreDefiWallet/0.3' },
    });
    const payload = (await response.json()) as LiFiQuote;
    if (!response.ok) {
      throw new Error(payload.message || 'Could not get a bridge quote.');
    }
    return parseLiFiQuote(payload, input.fromChainId, input.toChainId);
  } catch (error) {
    logger.error('Bridge quote failed', {
      fromChainId: input.fromChainId,
      toChainId: input.toChainId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw error instanceof Error ? error : new Error('Could not get a bridge quote.');
  }
}
