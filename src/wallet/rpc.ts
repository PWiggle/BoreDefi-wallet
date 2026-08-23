import { HDNodeWallet, JsonRpcProvider, TransactionResponse } from 'ethers';

import { logger } from '../logger';
import { CHAINS, type ChainId } from './chains';
import { walletFromMnemonic } from './mnemonic';

const providers = new Map<ChainId, JsonRpcProvider>();

export async function sendRpc(
  chainId: ChainId,
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  return getProvider(chainId).send(method, params);
}

export function getProvider(chainId: ChainId): JsonRpcProvider {
  const existing = providers.get(chainId);
  if (existing) {
    return existing;
  }
  const chain = CHAINS[chainId];
  const provider = new JsonRpcProvider(chain.rpcUrl, chain.id, { staticNetwork: true });
  providers.set(chainId, provider);
  return provider;
}

export function connectedWallet(mnemonic: string, chainId: ChainId): HDNodeWallet {
  return walletFromMnemonic(mnemonic).connect(getProvider(chainId));
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
    logger.error('Fee estimate failed', {
      chainId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Could not estimate network fee.');
  }
}

export async function sendNativeTransfer(
  mnemonic: string,
  to: string,
  amountWei: bigint,
  chainId: ChainId,
): Promise<TransactionResponse> {
  const wallet = connectedWallet(mnemonic, chainId);
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
    logger.error('Send failed', {
      chainId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Transaction failed. Nothing left this wallet.');
  }
}
