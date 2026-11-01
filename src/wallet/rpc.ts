import {
  type AbstractProvider,
  FallbackProvider,
  HDNodeWallet,
  JsonRpcProvider,
  TransactionResponse,
} from 'ethers';

import { logger } from '../logger';
import { CHAINS, type ChainId } from './chains';
import { walletFromMnemonic } from './mnemonic';
import { toUserError } from './tx-errors';

const providers = new Map<ChainId, AbstractProvider>();

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
    provider: new JsonRpcProvider(url, chain.id, { staticNetwork: true }),
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

export async function connectedWallet(mnemonic: string, chainId: ChainId): Promise<HDNodeWallet> {
  const wallet = await walletFromMnemonic(mnemonic);
  return wallet.connect(getProvider(chainId));
}

export async function fetchBalance(address: string, chainId: ChainId): Promise<bigint> {
  try {
    return await getProvider(chainId).getBalance(address);
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
  const feeData = await getProvider(chainId).getFeeData();
  return feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
}

export type FeeEstimate = {
  gasLimit: bigint;
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
    const [feeData, gasLimit] = await Promise.all([
      provider.getFeeData(),
      provider.estimateGas({ from, to, value: amountWei }),
    ]);
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
    return {
      gasLimit,
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
