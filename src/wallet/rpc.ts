import {
  type AbstractProvider,
  FallbackProvider,
  HDNodeWallet,
  JsonRpcProvider,
  TransactionResponse,
} from 'ethers';

import { logger } from '../logger';
import { CHAINS, type ChainId } from './chains';
import { bufferGasLimit } from './gas-limit';
import { walletFromMnemonic } from './mnemonic';
import { toUserError } from './tx-errors';

const providers = new Map<ChainId, AbstractProvider>();

/**
 * DO NOT REVERT (locked by swap-regression.test.ts; cause of the build 11 Swap "Network problem" banner).
 * One JSON-RPC request per HTTP call. ethers batches calls made in the same tick by default, and free public
 * RPCs cap batches (drpc's free plan answers HTTP 500 to a batch of more than 3), which ethers reports as
 * SERVER_ERROR ("Network problem").
 */
export const RPC_PROVIDER_OPTIONS = { staticNetwork: true, batchMaxCount: 1 } as const;
/** Per-endpoint limit inside readWithFallback, so one hanging public RPC cannot stall a screen. */
export const READ_ATTEMPT_TIMEOUT_MS = 8_000;

export async function sendRpc(
  chainId: ChainId,
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  const provider = getProvider(chainId);
  if (provider instanceof JsonRpcProvider) {
    return provider.send(method, params);
  }
  if (!(provider instanceof FallbackProvider)) {
    throw new Error('RPC provider cannot send.');
  }
  const ordered = [...provider.providerConfigs].sort((a, b) => a.priority - b.priority);
  let lastError: unknown;
  for (const config of ordered) {
    if (!(config.provider instanceof JsonRpcProvider)) {
      continue;
    }
    try {
      return await config.provider.send(method, params);
    } catch (error) {
      lastError = error;
      logger.error('RPC endpoint failed', {
        chainId,
        method,
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error('RPC request failed.');
}

export function getProvider(chainId: ChainId): AbstractProvider {
  const existing = providers.get(chainId);
  if (existing) {
    return existing;
  }
  const chain = CHAINS[chainId];
  const urls = chain.rpcUrls.length > 0 ? chain.rpcUrls : [chain.rpcUrl];
  const configs = urls.map((url, index) => ({
    provider: new JsonRpcProvider(url, chain.id, RPC_PROVIDER_OPTIONS),
    priority: index + 1,
    stallTimeout: 1500,
    weight: 1,
  }));
  const provider =
    configs.length === 1
      ? configs[0]!.provider
      : new FallbackProvider(configs, chain.id, { quorum: 1 });
  providers.set(chainId, provider);
  return provider;
}

const singleProviders = new Map<string, JsonRpcProvider>();

/** One JsonRpcProvider per endpoint, so a read can retry each public RPC on its own. */
export function getEndpointProviders(chainId: ChainId): JsonRpcProvider[] {
  const chain = CHAINS[chainId];
  const urls = chain.rpcUrls.length > 0 ? chain.rpcUrls : [chain.rpcUrl];
  return urls.map((url) => {
    const key = `${chainId}:${url}`;
    let provider = singleProviders.get(key);
    if (!provider) {
      provider = new JsonRpcProvider(url, chain.id, RPC_PROVIDER_OPTIONS);
      singleProviders.set(key, provider);
    }
    return provider;
  });
}

/** ethers errors that no other RPC will fix (bad input, bad address checksum, bad ABI). */
export function isDeterministicReadError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'INVALID_ARGUMENT' || code === 'MISSING_ARGUMENT' || code === 'UNEXPECTED_ARGUMENT';
}

function withAttemptTimeout<T>(run: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return run;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('RPC read timed out'), { code: 'TIMEOUT' })), ms);
  });
  return Promise.race([run, limit]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

/**
 * DO NOT replace with a bare getProvider(chainId) read (locked by swap-regression.test.ts).
 * Runs a read-only call on the chain's FallbackProvider, then on each public endpoint in order.
 * The first success wins. Deterministic input errors are thrown at once instead of retried.
 *
 * Needed because ethers' FallbackProvider with quorum 1 counts an *error* from one backend as a quorum
 * result and throws it (a single 429/5xx/dropped connection fails the read even when other RPCs are fine),
 * and it permanently skips a backend whose first block-number check failed (e.g. app opened offline).
 */
export async function readWithFallback<T>(
  chainId: ChainId,
  read: (provider: AbstractProvider) => Promise<T>,
  providers: AbstractProvider[] = [getProvider(chainId), ...getEndpointProviders(chainId)],
  attemptTimeoutMs: number = READ_ATTEMPT_TIMEOUT_MS,
): Promise<T> {
  let lastError: unknown;
  for (const provider of providers) {
    try {
      return await withAttemptTimeout(read(provider), attemptTimeoutMs);
    } catch (error) {
      if (isDeterministicReadError(error)) {
        throw error;
      }
      lastError = error;
      logger.error('RPC read failed, trying next endpoint', {
        chainId,
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error('RPC read failed.');
}

/** Retries a read a few times with a short pause. Deterministic input errors are not retried. */
export async function retryRead<T>(
  read: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const delayMs = options.delayMs ?? 1500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (isDeterministicReadError(error) || attempt === attempts - 1) {
        break;
      }
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('RPC read failed.');
}

export async function connectedWallet(mnemonic: string, chainId: ChainId): Promise<HDNodeWallet> {
  const wallet = await walletFromMnemonic(mnemonic);
  return wallet.connect(getProvider(chainId));
}

export async function fetchBalance(address: string, chainId: ChainId): Promise<bigint> {
  try {
    return await readWithFallback(chainId, (provider) => provider.getBalance(address));
  } catch (error) {
    logger.error('Balance request failed', {
      chainId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Could not load balance. Try again in a moment.');
  }
}

/** Current max fee per gas (EIP-1559 maxFeePerGas, or legacy gasPrice). */
export async function fetchMaxFeePerGas(chainId: ChainId): Promise<bigint> {
  const feeData = await readWithFallback(chainId, (provider) => provider.getFeeData());
  return feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
}

export type FeeEstimate = {
  /** Limit that is actually sent: eth_estimateGas plus headroom (bufferGasLimit). feeWei is priced on this. */
  gasLimit: bigint;
  /** Raw eth_estimateGas result, the realistic gas this send will use (for the fee shown to the user). */
  gasEstimate: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  feeWei: bigint;
};

export async function estimateNativeTransfer(
  from: string,
  to: string,
  amountWei: bigint,
  chainId: ChainId,
): Promise<FeeEstimate> {
  const provider = getProvider(chainId);
  try {
    const [feeData, gasEstimate] = await Promise.all([
      provider.getFeeData(),
      provider.estimateGas({ from, to, value: amountWei }),
    ]);
    const gasLimit = bufferGasLimit(gasEstimate);
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
    return {
      gasLimit,
      gasEstimate,
      maxFeePerGas,
      maxPriorityFeePerGas,
      feeWei: gasLimit * maxFeePerGas,
    };
  } catch (error) {
    throw toUserError('Fee estimate failed', error, { chainId, fallback: 'Could not estimate network fee.' });
  }
}

export async function sendNativeTransfer(
  mnemonic: string,
  to: string,
  amountWei: bigint,
  chainId: ChainId,
): Promise<TransactionResponse> {
  const wallet = await connectedWallet(mnemonic, chainId);
  try {
    const estimate = await estimateNativeTransfer(wallet.address, to, amountWei, chainId);
    return await wallet.sendTransaction({
      to,
      value: amountWei,
      gasLimit: estimate.gasLimit,
      maxFeePerGas: estimate.maxFeePerGas,
      maxPriorityFeePerGas: estimate.maxPriorityFeePerGas,
    });
  } catch (error) {
    throw toUserError('Send failed', error, { chainId, fallback: 'Transaction failed. Nothing left this wallet.' });
  }
}

/** Fee estimate for a zero-value contract call (ERC-20 transfer). */
export async function estimateContractCall(
  from: string,
  to: string,
  data: string,
  chainId: ChainId,
): Promise<FeeEstimate> {
  const provider = getProvider(chainId);
  try {
    const [feeData, gasEstimate] = await Promise.all([
      provider.getFeeData(),
      provider.estimateGas({ from, to, data, value: 0n }),
    ]);
    const gasLimit = bufferGasLimit(gasEstimate);
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
    return { gasLimit, gasEstimate, maxFeePerGas, maxPriorityFeePerGas, feeWei: gasLimit * maxFeePerGas };
  } catch (error) {
    throw toUserError('Fee estimate failed', error, { chainId, fallback: 'Could not estimate network fee.' });
  }
}

export async function sendContractCall(
  mnemonic: string,
  to: string,
  data: string,
  chainId: ChainId,
): Promise<TransactionResponse> {
  const wallet = await connectedWallet(mnemonic, chainId);
  try {
    const estimate = await estimateContractCall(wallet.address, to, data, chainId);
    return await wallet.sendTransaction({
      to,
      data,
      value: 0n,
      gasLimit: estimate.gasLimit,
      maxFeePerGas: estimate.maxFeePerGas,
      maxPriorityFeePerGas: estimate.maxPriorityFeePerGas,
    });
  } catch (error) {
    throw toUserError('Send failed', error, { chainId, fallback: 'Transaction failed. Nothing left this wallet.' });
  }
}
